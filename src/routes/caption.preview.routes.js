import express from "express";
import pkg from "@napi-rs/canvas";
import crypto from "node:crypto";
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { CaptionMetaSchema } from '../schemas/caption.schema.js';
import { bufferToTmp } from '../utils/tmp.js';
import { canvasFontString, normalizeWeight, normalizeFontStyle } from '../utils/font.registry.js';
import { wrapTextWithFont } from '../utils/caption.wrap.js';
import { deriveCaptionWrapWidthPx } from '../utils/caption.wrapWidth.js';
import { compileCaptionSSOT } from '../captions/compile.js';
import requireAuth from '../middleware/requireAuth.js';
const { createCanvas } = pkg;

// V3 raster schema (pixel-based with frame coordinates)
const RasterSchema = z.object({
  ssotVersion: z.literal(3),
  mode: z.literal('raster'),
  textRaw: z.string().optional(),  // NEW: raw text with newlines
  text: z.string().min(1, 'Caption text is required'),
  
  // Typography
  fontFamily: z.string().default('DejaVu Sans'),
  fontPx: z.coerce.number().int().finite().min(8).max(400).default(64),
  lineSpacingPx: z.coerce.number().int().finite().min(0).max(400).default(0),
  letterSpacingPx: z.coerce.number().default(0.5),  // Match karaoke QMain default (Spacing: 0.5)
  weightCss: z.string().default('normal'),
  fontStyle: z.string().default('normal'),
  textAlign: z.enum(['left', 'center', 'right']).default('center'),
  textTransform: z.string().default('none'),
  
  // Color & effects
  color: z.string().default('rgb(255,255,255)'),
  opacity: z.coerce.number().min(0).max(1).default(1.0),
  strokePx: z.coerce.number().default(3),
  strokeColor: z.string().default('rgba(0,0,0,0.85)'),
  shadowColor: z.string().default('rgba(0,0,0,0.6)'),
  shadowBlur: z.coerce.number().default(0),
  shadowOffsetX: z.coerce.number().default(1),
  shadowOffsetY: z.coerce.number().default(1),
  
  // Geometry (frame-space pixels)
  rasterW: z.coerce.number().int().min(100).max(1080),
  rasterH: z.coerce.number().int().min(50).max(1920),  // ✅ NEW
  yPx_png: z.coerce.number().int().min(0).max(1920),
  xPx_png: z.coerce.number().int().min(0).max(1080).optional(),  // NEW: absolute X position
  rasterPadding: z.coerce.number().int().default(24),
  padTop: z.coerce.number().int().optional(),
  padBottom: z.coerce.number().int().optional(),
  xExpr_png: z.string().default('(W-overlay_w)/2'),
  
  // Frame dimensions
  frameW: z.coerce.number().int().default(1080),
  frameH: z.coerce.number().int().default(1920),
  
  // Browser-rendered line data (REQUIRED in raster mode)
  lines: z.array(z.string()).min(1, "At least one line required"),
  totalTextH: z.coerce.number().int().min(1),
  yPxFirstLine: z.coerce.number().int(),
  previewFontString: z.string().optional(),
  
  // Optional legacy fields (ignored but allowed during transition)
  xPct: z.coerce.number().optional(),
  yPct: z.coerce.number().optional(),
  wPct: z.coerce.number().optional(),
});

const router = express.Router();

const previewRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute
  keyGenerator: (req) => req.user?.uid || req.ip, // Defensive fallback
  skip: (req) => req.method === "OPTIONS", // Skip CORS preflights
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ 
      success: false, 
      error: 'RATE_LIMIT_EXCEEDED', 
      detail: 'Too many requests. Please try again in a minute.' 
    });
  }
});

router.post("/caption/preview", requireAuth, previewRateLimit, express.json({ limit: "200kb" }), async (req, res) => {
  try {
    // V3 Raster Detection Gate - Only allow V3 raster mode
    const isV3Raster = req.body.ssotVersion === 3 && req.body.mode === 'raster';
    
    if (!isV3Raster) {
      // Strict gate: only V3 raster mode is allowed
      return res.status(400).json({
        ok: false,
        reason: 'V3_RASTER_REQUIRED',
        detail: 'V3 raster mode is required. Request must include ssotVersion: 3 and mode: "raster"'
      });
    }
    
    console.log('[caption-preview] Using V3 RASTER path');
    
    // Handle V3 raster format
    // Server-side fallback guard: ensure text field exists before schema validation
    const body = req.body || {};
    if ((!body.text || !String(body.text).trim()) && Array.isArray(body.lines) && body.lines.length) {
      console.log('[caption-preview:fallback] Missing text field, deriving from lines array');
      body.text = body.lines.join(' ').trim();
    }
    
    // Log raw request body for debugging
    console.log('[caption-preview:raw]', {
      hasText: !!body.text,
      hasTextRaw: !!body.textRaw,
      hasLines: Array.isArray(body.lines),
      linesCount: body.lines?.length || 0,
      textSample: body.text?.slice(0, 50),
      ssotVersion: body.ssotVersion,
      mode: body.mode
    });
    
    const parsed = RasterSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, reason: "INVALID_INPUT", detail: parsed.error.flatten() });
    }
    
    const data = parsed.data;
    const textRaw = data.textRaw || data.text;
    const text = textRaw.trim();
    if (!text) {
      return res.status(400).json({ ok: false, reason: "EMPTY_TEXT", detail: "Caption text cannot be empty" });
    }
    
    // Extract style fields from parsed payload (Zod already applied defaults)
    const styleInput = {
      fontPx: data.fontPx,
      letterSpacingPx: data.letterSpacingPx,
      weightCss: data.weightCss,
      fontStyle: data.fontStyle,
      fontFamily: data.fontFamily,
      lineSpacingPx: data.lineSpacingPx,
      color: data.color,
      opacity: data.opacity,
      strokePx: data.strokePx,
      strokeColor: data.strokeColor,
      shadowBlur: data.shadowBlur,
      shadowOffsetX: data.shadowOffsetX,
      shadowOffsetY: data.shadowOffsetY,
      shadowColor: data.shadowColor,
      textAlign: data.textAlign,
      textTransform: data.textTransform,
      wPct: data.wPct,
      internalPaddingPx: data.internalPaddingPx ?? data.rasterPadding
    };
    
    // ✅ Use compiler for SSOT
    const meta = compileCaptionSSOT({
      textRaw: textRaw || text,
      style: styleInput,
      frameW: data.frameW,
      frameH: data.frameH
    });
    
    // Extract values from compiler output
    const lines = meta.lines;
    const totalTextH = meta.totalTextH;
    const maxWidthPx = meta.maxWidthPx;
    const effectiveStyle = meta.effectiveStyle;
    
    // Use compiler's effectiveStyle values
    const fontPx = effectiveStyle.fontPx;
    const lineSpacingPx = effectiveStyle.lineSpacingPx;
    const letterSpacingPx = effectiveStyle.letterSpacingPx;
    const weightCss = effectiveStyle.weightCss;
    const fontStyle = effectiveStyle.fontStyle;
    const fontFamily = effectiveStyle.fontFamily;
    
    // Log SSOT compiler output
    console.log('[caption:ssot:preview]', {
      styleHash: meta.styleHash,
      wrapHash: meta.wrapHash,
      linesCount: lines.length,
      fontPx,
      letterSpacingPx,
      maxWidthPx
    });
    
    // DEBUG: Compare client lines vs server lines (diagnostic only, doesn't affect output)
    const clientLines = data.lines || [];
    if (clientLines.length > 0 && clientLines.length !== lines.length) {
      console.log('[preview-wrap:debug] Client vs server line count mismatch:', {
        clientLinesCount: clientLines.length,
        serverLinesCount: lines.length,
        maxWidthPx
      });
    }
    
    // Compute rasterH from final totalTextH + padding + shadows
    const cssPaddingTop = data.padTop || data.rasterPadding || 24;
    const cssPaddingBottom = data.padBottom || data.rasterPadding || 24;
    const shadowBlur = data.shadowBlur;
    const shadowOffsetY = data.shadowOffsetY;
    const rasterH = Math.round(
      totalTextH + 
      cssPaddingTop + 
      cssPaddingBottom + 
      Math.max(0, shadowBlur * 2) + 
      Math.max(0, shadowOffsetY)
    );
    
    // Keep yPx_png from client (positioning policy unchanged)
    const yPx_png = data.yPx_png;
    const yPxFirstLine = data.yPxFirstLine || (yPx_png + (data.rasterPadding || 24));
    const rasterW = data.rasterW;
    const rasterPadding = data.rasterPadding;
    
    // Log SSOT wrap result
    console.log('[preview-wrap:ssot]', {
      maxWidthPx,
      linesCount: lines.length,
      fontPx,
      fontFamily,
      weightCss,
      wPct: effectiveStyle.wPct,
      pad: effectiveStyle.internalPaddingPx
    });
    
    // Validate required fields
    if (!Number.isFinite(rasterW) || rasterW <= 0) {
      console.error('[raster] rasterW is missing or invalid:', rasterW);
      return res.status(400).json({ 
        ok: false, 
        reason: "INVALID_RASTER_W", 
        detail: `rasterW is required but missing or invalid: ${rasterW}` 
      });
    }
    
    if (!Number.isFinite(rasterPadding) || rasterPadding < 0) {
      console.error('[raster] rasterPadding is missing or invalid:', rasterPadding);
      return res.status(400).json({ 
        ok: false, 
        reason: "INVALID_RASTER_PADDING", 
        detail: `rasterPadding is required but missing or invalid: ${rasterPadding}` 
      });
    }
    
    // Call renderCaptionRaster with server SSOT lines
    const rasterResult = await renderCaptionRaster({
      text,
      lines: lines,  // Server-computed lines
      maxLineWidth: maxWidthPx,  // Canonical width
      xPct: data.xPct,  // Not used in raster, but pass for consistency
      yPct: data.yPct,  // Not used in raster, but pass for consistency
      wPct: data.wPct,  // Not used in raster, but pass for consistency
      fontPx,
      fontFamily: data.fontFamily,
      weightCss: data.weightCss,
      fontStyle: data.fontStyle,
      textAlign: data.textAlign,
      letterSpacingPx,
      textTransform: data.textTransform,
      color: data.color,
      opacity: data.opacity,
      strokePx: data.strokePx,
      strokeColor: data.strokeColor,
      shadowColor: data.shadowColor,
      shadowBlur: data.shadowBlur,
      shadowOffsetX: data.shadowOffsetX,
      shadowOffsetY: data.shadowOffsetY,
      lineSpacingPx,
      totalTextH,
      yPxFirstLine,
      // ✅ Pass raster dimensions directly (no clientRaster* prefix)
      rasterW,
      rasterH,
      rasterPadding,
      W: data.frameW,
      H: data.frameH
    });
    
    // Compute PNG hash
    const pngBuffer = Buffer.from(rasterResult.rasterUrl.split(',')[1], 'base64');
    const rasterHash = crypto.createHash('sha256').update(pngBuffer).digest('hex').slice(0, 16);
    
    // Use server-computed values (always SSOT now)
    const finalLines = lines;  // Server-computed lines
    const finalRasterH = rasterH;  // Server-computed rasterH
    const finalTotalTextH = totalTextH;  // Server-computed totalTextH
    const finalYPx_png = yPx_png;  // Keep client value (positioning unchanged)
    
    // Build complete ssotMeta with server SSOT values
    const ssotMeta = {
      ssotVersion: 3,
      mode: 'raster',
      
      // Geometry lock (same as V2)
      frameW: data.frameW,
      frameH: data.frameH,
      bgScaleExpr: "scale='if(gt(a,1080/1920),-2,1080)':'if(gt(a,1080/1920),1920,-2)'",
      bgCropExpr: "crop=1080:1920",
      
      // Server SSOT values
      rasterUrl: rasterResult.rasterUrl,
      rasterW: data.rasterW,  // Client canonical value (width doesn't change)
      rasterH: finalRasterH,  // Server-computed
      rasterPadding: data.rasterPadding,  // Client canonical value
      xExpr_png: data.xExpr_png,  // Client canonical value
      yPx_png: finalYPx_png,  // Keep client value (no positioning policy change)
      
      // Verification hashes
      rasterHash,
      previewFontString: rasterResult.previewFontString,
      previewFontHash: rasterResult.previewFontHash,
      
      // Typography (pass-through)
      textRaw: data.textRaw,  // Pass through if provided
      text,
      fontPx,
      fontFamily: data.fontFamily,
      weightCss: data.weightCss,
      fontStyle: data.fontStyle,
      textAlign: data.textAlign,
      letterSpacingPx,
      textTransform: data.textTransform,
      
      // Color & effects (pass-through)
      color: data.color,
      opacity: data.opacity,
      strokePx: data.strokePx,
      strokeColor: data.strokeColor,
      shadowColor: data.shadowColor,
      shadowBlur: data.shadowBlur,
      shadowOffsetX: data.shadowOffsetX,
      shadowOffsetY: data.shadowOffsetY,
      
      // Server SSOT lines and geometry
      lines: finalLines,  // Server-computed lines
      lineSpacingPx,
      totalTextH: finalTotalTextH,  // Server-computed totalTextH
    };
    
    // Log for verification (use final values)
    console.log('[v3:raster:complete]', {
      rasterW: ssotMeta.rasterW,
      rasterH: ssotMeta.rasterH,
      yPx_png: ssotMeta.yPx_png,
      lines: ssotMeta.lines.length,
      rasterHash: rasterHash.slice(0, 8) + '...'
    });
    
    console.log('[v3:preview:respond]', { 
      have: Object.keys(ssotMeta),
      required: ['rasterUrl', 'rasterW', 'rasterH', 'rasterPadding', 'yPx_png', 'bgScaleExpr', 'bgCropExpr', 'rasterHash', 'previewFontString', 'totalTextH', 'lines']
    });
    
    // Add parity checklist log (use final values)
    console.log('[PARITY_CHECKLIST]', {
      mode: 'raster',
      frameW: ssotMeta.frameW,
      frameH: ssotMeta.frameH,
      rasterW: ssotMeta.rasterW,
      rasterH: ssotMeta.rasterH,
      xExpr_png: ssotMeta.xExpr_png,
      yPx_png: ssotMeta.yPx_png,
      rasterPadding: ssotMeta.rasterPadding,
      padTop: data.padTop || data.rasterPadding,
      padBottom: data.padBottom || data.rasterPadding,
      previewFontString: ssotMeta.previewFontString,
      previewFontHash: ssotMeta.previewFontHash,
      rasterHash,
      bgScaleExpr: ssotMeta.bgScaleExpr,
      bgCropExpr: ssotMeta.bgCropExpr,
      willMatchPreview: true,
      linesCount: ssotMeta.lines.length
    });
    
    // DEBUG ONLY: Structured parity log before response
    if (process.env.DEBUG_CAPTION_PARITY === '1') {
      const clientLinesCount = data.lines?.length || 0;
      const serverLinesCount = ssotMeta.lines?.length || 0;
      const rewrapped = rasterResult.rewrapped || (clientLinesCount !== serverLinesCount);
      console.log('[PARITY:SERVER:RESPONSE]', JSON.stringify({
        textLen: text?.length || 0,
        clientLinesCount: clientLinesCount,
        serverLinesCount: serverLinesCount,
        rewrapped: rewrapped,
        rasterW: ssotMeta.rasterW,
        rasterH: ssotMeta.rasterH,
        yPx_png: ssotMeta.yPx_png,
        fontPx: ssotMeta.fontPx,
        weightCss: ssotMeta.weightCss,
        previewFontString: ssotMeta.previewFontString,
        totalTextH: ssotMeta.totalTextH,
        timestamp: Date.now()
      }));
    }
    
    return res.status(200).json({
      ok: true,
      data: {
        imageUrl: null,  // V3 raster mode returns PNG in meta.rasterUrl
        wPx: data.frameW,
        hPx: data.frameH,
        xPx: 0,
        // yPx removed - use meta.yPx_png instead (no ambiguous top-level field)
        meta: ssotMeta,
      },
      // ✅ Return compiler meta for client to save
      meta: meta
    });
    
    // Legacy path gate - block legacy code path
    // LEGACY PATH - DEPRECATED, DO NOT USE
    if (process.env.ALLOW_LEGACY_PREVIEW !== '1') {
      console.warn('[caption-preview] Legacy path attempted but disabled');
      return res.status(400).json({
        ok: false,
        reason: 'LEGACY_PATH_DISABLED',
        detail: 'Legacy preview path is disabled. Use V3 raster mode (ssotVersion: 3, mode: "raster")'
      });
    }
    
    console.warn('[caption-preview] LEGACY PATH ENABLED VIA ENV - DEPRECATED');
    // Wrap in block scope to isolate variables from V3 path
    {
    // STEP 0: Sanitize inputs - strip computed fields that should NEVER come from client
      const COMPUTED_FIELDS = [
        "lineSpacingPx", "totalTextH", "totalTextHPx", "yPxFirstLine", "lineHeight",
        "hpct", "hPct", "hPx", "v2", "baselines"
      ];
      COMPUTED_FIELDS.forEach(k => {
        if (req.body && k in req.body) {
          console.log(`[caption-preview-sanitize] Removing computed field from request: ${k}=${req.body[k]}`);
          delete req.body[k];
        }
      });
      
      // Handle new draggable overlay format
      const legacyParsed = CaptionMetaSchema.safeParse(req.body);
      if (!legacyParsed.success) {
        return res.status(400).json({ ok: false, reason: "INVALID_INPUT", detail: legacyParsed.error.flatten() });
      }

      // STEP 1: Extract ONLY safe input fields (no spreading)
      const text = String(legacyParsed.data.text || "").trim();
      const xPct = Number(legacyParsed.data.xPct ?? 0.5);
      const yPct = Number(legacyParsed.data.yPct ?? 0.5);
      const wPct = Number(legacyParsed.data.wPct ?? 0.8);
      const fontPx = Number(legacyParsed.data.sizePx || legacyParsed.data.fontPx || 54);
      
      // Log received styling fields for debugging
      console.log('[caption-preview] Received styling fields:', {
        fontPx: legacyParsed.data.fontPx,
        weightCss: legacyParsed.data.weightCss,
        fontStyle: legacyParsed.data.fontStyle,
        letterSpacingPx: legacyParsed.data.letterSpacingPx,
        textTransform: legacyParsed.data.textTransform,
        strokePx: legacyParsed.data.strokePx,
        strokeColor: legacyParsed.data.strokeColor,
        shadowBlur: legacyParsed.data.shadowBlur,
        shadowOffsetX: legacyParsed.data.shadowOffsetX,
        shadowOffsetY: legacyParsed.data.shadowOffsetY,
        textAlign: legacyParsed.data.textAlign,
        color: legacyParsed.data.color,
        opacity: legacyParsed.data.opacity
      });
      
      // Typography
      const fontFamily = String(legacyParsed.data.fontFamily || 'DejaVu Sans');
      const weightCss = String(legacyParsed.data.weightCss || 'normal');
      const fontStyle = legacyParsed.data.fontStyle || 'normal';
      const textAlign = legacyParsed.data.textAlign || 'center';
      const letterSpacingPx = Number(legacyParsed.data.letterSpacingPx ?? 0);
      const textTransform = legacyParsed.data.textTransform || 'none';
      
      // Color & effects
      const color = String(legacyParsed.data.color || 'rgb(255, 255, 255)');
      const opacity = Number(legacyParsed.data.opacity ?? 0.8);
      
      // Stroke (outline)
      const strokePx = Number(legacyParsed.data.strokePx ?? 0);
      const strokeColor = String(legacyParsed.data.strokeColor || 'rgba(0,0,0,0.85)');
      
      // Shadow
      const shadowColor = String(legacyParsed.data.shadowColor || 'rgba(0,0,0,0.6)');
      const shadowBlur = Number(legacyParsed.data.shadowBlur ?? 12);
      const shadowOffsetX = Number(legacyParsed.data.shadowOffsetX ?? 0);
      const shadowOffsetY = Number(legacyParsed.data.shadowOffsetY ?? 2);
      
      const placement = 'custom';
      const internalPadding = 32;
      
      // SSOT clamp for yPct; keep 0..1
      const SAFE_TOP = 0.10, SAFE_BOTTOM = 0.90;
      const yPctClamped = Math.min(Math.max(yPct, SAFE_TOP), SAFE_BOTTOM);

      // STEP 2: Wrap text preserving explicit \n (using canvas ctx for measurement)
      if (!text || text.length === 0) {
        return res.status(400).json({ ok: false, reason: "INVALID_INPUT", detail: "text required" });
      }
      
      const W = 1080, H = 1920;
      const canvas = createCanvas(W, H);
      const ctx = canvas.getContext("2d");
      
      // Setup font for measurement - use SSOT font registry
      const family = pickFamily(fontFamily);
      const font = canvasFontString(weightCss, fontStyle, fontPx, 'DejaVu Sans');
      ctx.font = font;
      
      // Compute maxWidth accounting for internal padding (match UI box exactly)
      const CANVAS_W = 1080;
      const boxW = Math.round(wPct * CANVAS_W);
      const maxWidth = Math.max(0, boxW - 2 * internalPadding);
      
      const segments = text.split('\n');  // Split on explicit newlines first
      const lines = [];

      for (const segment of segments) {
        const words = segment.trim().split(/\s+/).filter(Boolean);
        let line = "";
        
        for (const word of words) {
          const test = line ? line + " " + word : word;
          if (ctx.measureText(test).width > maxWidth && line) {
            lines.push(line);
            line = word;
          } else {
            line = test;
          }
        }
        if (line) lines.push(line);
      }

      console.log('[caption-preview-wrap] Wrapped into lines:', lines.length, 'from segments:', segments.length);
      
      // STEP 3: Compute metrics from scratch - NEVER use incoming computed values
      if (!Number.isFinite(fontPx) || fontPx < 24 || fontPx > 200) {
        return res.status(400).json({ ok: false, reason: "INVALID_INPUT", detail: "fontPx must be 24-200" });
      }

      try {
        // SSOT V3: Use client values directly; only compute if missing
        // Line spacing: use client SSOT if provided, otherwise compute
        let lineSpacingPx;
        if (Number.isFinite(legacyParsed.data.lineSpacingPx)) {
          lineSpacingPx = legacyParsed.data.lineSpacingPx;
          console.log('[preview:ssot] Using client lineSpacingPx:', lineSpacingPx);
        } else {
          const lineHeightMultiplier = 1.15;
          const lineHeight = Math.round(fontPx * lineHeightMultiplier);
          lineSpacingPx = lines.length === 1 ? 0 : Math.round(lineHeight - fontPx);
          console.log('[preview:computed] Computed lineSpacingPx:', lineSpacingPx);
        }

        const totalTextH = lines.length * fontPx + (lines.length - 1) * lineSpacingPx;
        
        // SSOT formula enforcement
        const expectedTotalTextH = (lines.length * fontPx) + ((lines.length - 1) * lineSpacingPx);
        if (Math.abs(totalTextH - expectedTotalTextH) > 0.5) {
          throw new Error(`[ssot/v3:INVARIANT] totalTextH=${totalTextH} != expected=${expectedTotalTextH}`);
        }
        
        // STEP 4: Guard against absurd metrics (before they can propagate)
        if (totalTextH > lines.length * fontPx * 3 || lineSpacingPx > fontPx * 2) {
          console.error('[caption-preview-ERROR] bad metrics', { 
            lineHeight, lineSpacingPx, totalTextH, lines: lines.length, fontPx 
          });
          return res.status(500).json({ 
            ok: false, 
            reason: 'COMPUTATION_ERROR',
            detail: `Metric out of bounds: totalTextH=${totalTextH}, lineSpacingPx=${lineSpacingPx}`
          });
        }

        if (lines.length > 50) {
          console.error('[caption-preview-ERROR] Too many lines:', lines.length);
          return res.status(400).json({ 
            ok: false, 
            reason: "TEXT_TOO_LONG", 
            detail: `Text wrapped into ${lines.length} lines` 
          });
        }

        // STEP 5: Compute positioning (no client values)
        const anchorY = Math.round(yPctClamped * H);
        let yPxFirstLine = Math.round(anchorY - (totalTextH / 2));
        
        // Apply safe margins
        const SAFE_TOP_PX = Math.max(50, H * 0.05);
        const SAFE_BOTTOM_PX = Math.max(50, H * 0.08);
        
        if (yPxFirstLine < SAFE_TOP_PX) {
          console.log('[caption-preview-clamp] yPxFirstLine', yPxFirstLine, '→', SAFE_TOP_PX);
          yPxFirstLine = SAFE_TOP_PX;
        }
        if (yPxFirstLine + totalTextH > H - SAFE_BOTTOM_PX) {
          const newY = H - SAFE_BOTTOM_PX - totalTextH;
          console.log('[caption-preview-clamp] yPxFirstLine', yPxFirstLine, '→', newY);
          yPxFirstLine = newY;
        }

        // Checkpoint log before response
        console.log('[ssot/v3:preview:FINAL]', {
          fontPx, lineSpacingPx, totalTextH, yPxFirstLine,
          lines: lines.length, yPct: yPctClamped, H: 1920,
          formula: `${lines.length}*${fontPx} + ${lines.length-1}*${lineSpacingPx} = ${totalTextH}`
        });

        // Finite number validation
        if (!Number.isFinite(fontPx) || !Number.isFinite(lineSpacingPx) || 
            !Number.isFinite(totalTextH) || !Number.isFinite(yPxFirstLine)) {
          throw new Error('[ssot/v3:preview:INVALID_NUM]');
        }

        // SSOT V3: Render caption to transparent PNG at final render scale
        const rasterResult = await renderCaptionRaster({
          text,
          lines: lines,
          maxLineWidth: maxWidth,  // Pass preview's maxLineWidth for validation
          xPct,
          yPct: yPctClamped,
          wPct,
          fontPx,
          fontFamily,
          weightCss,
          fontStyle,
          textAlign,
          letterSpacingPx,
          textTransform,
          color,
          opacity,
          strokePx,
          strokeColor,
          shadowColor,
          shadowBlur,
          shadowOffsetX,
          shadowOffsetY,
          lineSpacingPx,
          totalTextH,
          yPxFirstLine,
          W,
          H
        });

        // Render preview image for display
        const previewUrl = await renderPreviewImage({
          text, 
          lines: lines,
          xPct, yPct: yPctClamped, wPct, sizePx: fontPx,
          fontFamily, weightCss, color, opacity, textAlign: 'center'
        });
        
        // STEP 6: Build SSOT V3 meta (raster mode) - echo back actual server values
        const ssotMeta = {
          ssotVersion: 3,
          mode: 'raster',
          
          // 🔒 GEOMETRY LOCK - ensures render uses same target dimensions
          frameW: 1080,
          frameH: 1920,
          bgScaleExpr: "scale='if(gt(a,1080/1920),-2,1080)':'if(gt(a,1080/1920),1920,-2)'",
          bgCropExpr: "crop=1080:1920",
          
          // Placement inputs
          text,
          // NOTE: xPct, yPct, wPct NOT used in raster mode - kept for debug only
          // Client should use rasterW/yPx_png/rasterPadding instead
          
          // Typography
          fontPx,
          fontFamily,
          weightCss,
          fontStyle,
          textAlign,
          letterSpacingPx,
          textTransform,
          
          // Color & effects
          color,
          opacity,
          
          // Stroke
          strokePx,
          strokeColor,
          
          // Shadow
          shadowColor,
          shadowBlur,
          shadowOffsetX,
          shadowOffsetY,
          
          // Layout
          placement,
          internalPadding,
          
          // Exact PNG details - echo back actual server values
          rasterUrl: rasterResult.rasterUrl,
          rasterW: rasterResult.rasterW,
          rasterH: rasterResult.rasterH,
          rasterPadding: rasterResult.padding,  // CRITICAL: actual padding used in PNG
          xExpr_png: '(W - overlay_w)/2',  // Center horizontally
          yPx_png: rasterResult.yPx,        // PNG top-left anchor (NOT text baseline)
          previewFontString: rasterResult.previewFontString,
          previewFontHash: rasterResult.previewFontHash,
          
          // Keep for debugging (but these are NOT used in v3 raster mode)
          lines: lines,
          lineSpacingPx,
          totalTextH,
        };
        
        // Add PNG hash for integrity validation
        const pngBuffer = Buffer.from(rasterResult.rasterUrl.split(',')[1], 'base64');
        const rasterHash = crypto.createHash('sha256').update(pngBuffer).digest('hex').slice(0, 16);
        ssotMeta.rasterHash = rasterHash;
        
        console.log('[raster] Rendered caption PNG:', {
          rasterW: rasterResult.rasterW,
          rasterH: rasterResult.rasterH,
          yPx: rasterResult.yPx,
          urlLength: rasterResult.rasterUrl?.length
        });
        
        // V3 logging for debugging
        console.log('[v3:preview:FINAL]', {
          ssotVersion: ssotMeta.ssotVersion,
          mode: ssotMeta.mode,
          fontPx,
          lineSpacingPx,
          totalTextH,
          yPxFirstLine,
          lines: lines.length,
          rasterW: rasterResult.rasterW,
          rasterH: rasterResult.rasterH
        });
        
        // Parity logging for client-server matching
        console.log('[parity:serverPreview]', {
          frameW: 1080, frameH: 1920,
          fontPx, lineSpacingPx, letterSpacingPx,
          yPxFirstLine, rasterPadding: rasterResult.padding, yPx_png: rasterResult.yPx,
          rasterW: rasterResult.rasterW, rasterH: rasterResult.rasterH,
          wPct, xPct, yPct: yPctClamped,
          previewFontString: rasterResult.previewFontString
        });
        
        // Assertion checks for v3 raster mode
        console.log('[v3:assert]', {
          rasterW: rasterResult.rasterW,
          rasterH: rasterResult.rasterH,
          y: rasterResult.yPx,
          pngIsSmall: rasterResult.rasterW < 600 && rasterResult.rasterH < 600,
          hasStyles: Boolean(color) && Boolean(fontFamily) && Boolean(weightCss),
          hasAdvancedStyles: Boolean(fontStyle !== 'normal' || letterSpacingPx !== 0 || strokePx > 0 || shadowBlur > 0)
        });

        return res.status(200).json({
          ok: true,
          data: {
            imageUrl: previewUrl,
            wPx: W,
            hPx: H,
            xPx: 0,
            yPx: yPxFirstLine,
            meta: ssotMeta,
          }
        });
      } catch (e) {
        console.error('[overlay-preview] Preview failed:', e);
        return res.status(500).json({ ok: false, reason: 'RENDER_FAILED', detail: e.message });
      }
    } // End legacy path block scope
    // Note: The following else block appears to be unreachable (V3 path returns early above)
    // } else {
    //   console.log('[caption-preview] Using LEGACY path (placement:', req.body.placement, ', yPct:', req.body.yPct, ', v2:', req.body.v2, ', ssotVersion:', req.body.ssotVersion, ')');
    // }
    
    // Legacy format handling (unreachable if V3 path returns above, but wrapped for scope isolation)
    {
    const b = req.body || {};
    const s = b.style || {};

    // SSOT: prefer style.*, then fall back to top-level
    const text = (req.body?.style?.text ?? req.body?.text ?? "").toString().trim();
    if (!text) {
      return res.status(400).json({ success: false, error: "INVALID_INPUT", detail: "text required" });
    }

    const fontFamily = (s.fontFamily ?? b.fontFamily ?? "DejaVu Sans Local");
    const weightCss = (s.weightCss ?? b.weightCss ?? "bold");
    const fontPx = (s.fontPx ?? b.fontPx ?? 48);
    const color = (s.color ?? b.color ?? "#FFFFFF");
    const opacity = Number(s.opacity ?? b.opacity ?? 0.85);
    const shadow = (s.shadow ?? b.shadow ?? true);
    const showBox = (s.showBox ?? b.showBox ?? false);
    const boxColor = (s.boxColor ?? b.boxColor ?? "rgba(0,0,0,0.35)");
    const yPct = (s.yPct ?? b.yPct);
    const lineHeight = (s.lineHeight ?? b.lineHeight ?? 1.1);
    const padding = (s.padding ?? b.padding ?? 24);
    const maxWidthPct = (s.maxWidthPct ?? b.maxWidthPct ?? 0.8);
    const borderRadius = (s.borderRadius ?? b.borderRadius ?? 16);

    // Read placement from SSOT path first, then fallback, with validation
    const rawPlacement = (req.body?.style?.placement ?? req.body?.placement ?? 'center');
    const placement = ['top','center','bottom'].includes(String(rawPlacement).toLowerCase())
      ? String(rawPlacement).toLowerCase()
      : 'center';

    // Force consistent canvas dimensions for all caption previews
    const W = 1080; // Standard canvas width
    const H = 1920; // Standard canvas height

    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ success:false, error:"INVALID_INPUT", detail:"text required" });
    }

    // Server-side font clamping to prevent overflow (match frontend limits)
    const ABS_MAX_FONT = 120; // Match frontend API_MAX_PX for larger text
    const ABS_MIN_FONT = 32;  // Match frontend API_MIN_PX
    const clampedFontPx = Math.max(ABS_MIN_FONT, Math.min(Number(fontPx) || 48, ABS_MAX_FONT));

    // Validate required numeric inputs
    if (!Number.isFinite(clampedFontPx)) {
      return res.status(400).json({ success:false, error:"INVALID_INPUT", detail:"fontPx must be a valid number" });
    }

    // SSOT: Server derives effective values from client intent
    // Define helper functions FIRST before using them
    function resolveYpct(clientYPct, clientPlacement) {
      // If client provided yPct, use it (they know their intent)
      if (clientYPct !== undefined && clientYPct !== null) {
        return Math.max(0.1, Math.min(0.9, Number(clientYPct)));
      }
      // Otherwise derive from placement
      switch (clientPlacement) {
        case 'top': return 0.10;
        case 'center': return 0.50;
        case 'bottom': return 0.90;
        default: return 0.50;
      }
    }
    
    function resolveFontFamilyUsed(clientFontFamily) {
      // SSOT: Use consistent font family name that matches registration
      const fontMap = {
        'DejaVu Sans': 'DejaVu Sans',
        'DejaVu Sans Local': 'DejaVu Sans',
        'DejaVu Serif Local': 'DejaVu Serif',
        'DejaVu Serif Bold Local': 'DejaVu Serif Bold'
      };
      return fontMap[clientFontFamily] || 'DejaVu Sans';
    }
    
    function clamp01(value) {
      return Math.max(0, Math.min(1, Number(value) || 0.85));
    }

    // Derive effective values AFTER function definitions
    const yPctUsed = resolveYpct(yPct, placement);
    const fontFamilyUsed = resolveFontFamilyUsed(fontFamily);
    // SSOT: Handle weight properly - we only have bold font file, so use bold for bold weight
    const weightUsed = (weightCss === 'bold' || weightCss === 700) ? 'bold' : 'normal';
    const opacityUsed = clamp01(opacity);
    
    console.log(`[caption] Derived values: yPctUsed=${yPctUsed}, fontFamilyUsed=${fontFamilyUsed}, weightUsed=${weightUsed}, opacityUsed=${opacityUsed}`);

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    const maxW = Math.round(W * Number(maxWidthPct));
    console.log(`[caption] Using maxWidthPct=${maxWidthPct}, maxW=${maxW}`);
    
    // Apply derived values to canvas
    // SSOT: Use proper weight handling - since we only have bold font, use bold for bold weight
    const fontWeight = (weightUsed === 'bold') ? 'bold' : 'normal';
    const fontString = `${fontWeight} ${clampedFontPx}px "${fontFamilyUsed}"`;
    console.log(`[caption] Font set to: ${fontString}`);
    ctx.font = fontString;
    ctx.fillStyle = color;
    ctx.globalAlpha = opacityUsed;

    // word-wrap
    function wrapLines(t) {
      const words = t.split(/\s+/);
      const lines = [];
      let line = "";
      for (const w of words) {
        const test = line ? line + " " + w : w;
        if (ctx.measureText(test).width > maxW && line) {
          lines.push(line); line = w;
        } else line = test;
      }
      if (line) lines.push(line);
      return lines;
    }
    const lines = wrapLines(text);
    const lh = Math.round(clampedFontPx * Number(lineHeight));
    const textH = lines.length * lh;
    
    // Ensure we have valid text dimensions
    if (!lines.length || !Number.isFinite(textH)) {
      return res.status(400).json({ success:false, error:"INVALID_INPUT", detail:"failed to compute text dimensions" });
    }
    
    // Variables already defined above
    
    // Calculate text dimensions
    const totalTextH = lines.length * lh;
    
    // SSOT: yPct is the anchor point along canvas height
    // placement: 'top' → anchor is top of text block
    // placement: 'center' → center of text block  
    // placement: 'bottom' → bottom of text block
    const anchorY = Math.round(H * yPctUsed);
    
    // Add internal padding to the text box to prevent clipping
    const internalPadding = 32; // 32px padding on all sides
    const boxW = maxW + internalPadding * 2;
    const boxH = textH + internalPadding * 2;
    const x = Math.round((W - boxW) / 2);
    
    // Calculate text block position based on anchor semantics
    let textBlockTop;
    if (placement === 'top') {
      // Anchor is top of text block
      textBlockTop = anchorY;
    } else if (placement === 'center') {
      // Anchor is center of text block
      textBlockTop = anchorY - (totalTextH / 2);
    } else if (placement === 'bottom') {
      // Anchor is bottom of text block
      textBlockTop = anchorY - totalTextH;
    } else {
      // Default to center
      textBlockTop = anchorY - (totalTextH / 2);
    }
    
    // Apply padding to get final text start position
    const textStartY = textBlockTop + internalPadding;
    
    console.log(`[caption] placement=${placement}, fontPx=${clampedFontPx}, totalTextH=${totalTextH}, yPct=${yPctUsed}, anchorY=${anchorY}, textBlockTop=${textBlockTop}, textStartY=${textStartY}`);
    console.log(`[caption] effective values: fontFamilyUsed=${fontFamilyUsed}, weightUsed=${weightUsed}, opacityUsed=${opacityUsed}`);

    if (showBox) {
      ctx.save();
      ctx.globalAlpha = 1.0;
      ctx.fillStyle = boxColor;
      roundRect(ctx, x, textBlockTop, boxW, boxH, borderRadius);
      ctx.fill();
      ctx.restore();
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "top";      // IMPORTANT: Use top baseline for proper positioning
    if (shadow) { ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 2; }
    else { ctx.shadowColor = "transparent"; }

    // Position text within the padded box
    let cy = textStartY;
    for (const line of lines) { ctx.fillText(line, W/2, cy); cy += lh; }

    const dataUrl = canvas.toDataURL("image/png");
    
    // Include meta information for render reuse with proper height data
    const meta = {
      lines: lines,
      fontPx: clampedFontPx, // Use clamped font size
      lineSpacing: lh,
      xPct: 50, // centered
      yPct: yPctUsed, // Use derived yPct (anchor point)
      align: "center",
      vAlign: placement === "top" ? "top" : placement === "bottom" ? "bottom" : "center",
      previewHeightPx: H,
      opacityUsed: opacityUsed, // Echo derived opacity
      totalTextH: totalTextH, // Total text height for positioning
      hPx: boxH, // Height of padded text box
      wPx: boxW, // Width of padded text box
      placement: placement, // Include placement for reference
      fontFamilyUsed: fontFamilyUsed, // Echo derived font family
      weightUsed: weightUsed, // Echo derived weight
      internalPadding: internalPadding, // Include padding info for frontend
      safeTopMarginPct: 0.1, // Document safe margins
      safeBottomMarginPct: 0.1,
      // SSOT: Include anchor positioning info for client
      anchorY: anchorY, // Server-computed anchor point
      textBlockTop: textBlockTop // Server-computed text block top position
    };
    
    // Debug logging
    console.log('[caption-overlay] meta:', {
      fontPx: clampedFontPx,
      lineSpacing: lh,
      xPct: 50,
      yPct: meta.yPct,
      vAlign: meta.vAlign,
      fontFamilyUsed: meta.fontFamilyUsed,
      weightUsed: meta.weightUsed,
      opacityUsed: meta.opacityUsed,
      frame: { W, H },
      safeW: Math.floor(W * 0.92),
      safeH: Math.floor(H * 0.84)
    });
    
    return res.json({
      ok: true,
      data: {
        imageUrl: dataUrl,
        wPx: W,
        hPx: H,
        xPx: 0,
        yPx: textStartY,
        meta: {
          // Restrict to SSOT meta keys for legacy branch too
          yPct: yPctUsed,
          totalTextH: totalTextH,
          totalTextHPx: totalTextH,  // ← ADD: duplicate for client compatibility
          lineSpacingPx: lh,
          fontPx: clampedFontPx,
          internalPadding,
          placement,
          wPx: W,
          hPx: H,
          lines: lines,
          baselines: undefined,
        }
      }
    });
    } // End legacy format handling block scope
  } catch (e) {
    return res.status(400).json({ success:false, error:"INVALID_INPUT", detail:String(e?.message || e) });
  }
});

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Smoke test route for quick debugging - gated behind VAIFORM_DEBUG + requireAuth
router.get("/diag/caption-smoke", (req, res, next) => {
  if (process.env.VAIFORM_DEBUG !== "1") {
    return res.status(404).end();
  }
  next();
}, requireAuth, async (req, res) => {
  try {
    const W = 1080, H = 1920;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    
    // Simple test with DejaVu font
    ctx.font = `bold 48px "DejaVu Sans Local"`;
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SMOKE TEST", W/2, H/2);
    
    const dataUrl = canvas.toDataURL("image/png");
    return res.json({ 
      ok: true, 
      message: "Caption smoke test passed",
      hasDataUrl: !!dataUrl,
      dataUrlLength: dataUrl.length 
    });
  } catch (e) {
    return res.status(500).json({ 
      ok: false, 
      error: String(e?.message || e),
      message: "Caption smoke test failed"
    });
  }
});

// SSOT V3: Render caption to transparent PNG at final render scale
async function renderCaptionRaster(meta) {
  const W = meta.W || 1080;
  const H = meta.H || 1920;
  
  // Extract all styling fields
  const fontWeight = String(meta.weightCss ?? '400');
  const fontStyle = meta.fontStyle ?? 'normal'; // 'italic'|'normal'|'oblique'
  const fontFamilyName = pickFamily(meta.fontFamily);
  const fontPx = meta.fontPx;
  const lines = meta.lines || [];
  const textAlign = meta.textAlign ?? 'center';
  const letterSpacingPx = meta.letterSpacingPx ?? 0;
  
  // ⛑️ Ensure `text` exists in this scope for rewrap & logging.
  // Fallback: derive from lines if text is missing (defensive)
  const text =
    typeof meta.text === 'string' && meta.text.length
      ? meta.text
      : Array.isArray(lines) && lines.length
        ? lines.join('\n')
        : '';
  
  // Color & opacity
  const opacity = meta.opacity ?? 1.0;
  const color = toRgba(meta.color, opacity);
  
  // Stroke (outline)
  const strokePx = meta.strokePx ?? 0;
  const strokeColor = meta.strokeColor ?? 'rgba(0,0,0,0.85)';
  
  // Shadow
  const shadowColor = meta.shadowColor ?? 'rgba(0,0,0,0.6)';
  const shadowBlur = meta.shadowBlur ?? 12;
  const shadowOffsetX = meta.shadowOffsetX ?? 0;
  const shadowOffsetY = meta.shadowOffsetY ?? 2;
  
  // Text transform
  const applyTransform = (text) => {
    const transform = meta.textTransform ?? 'none';
    switch (transform) {
      case 'uppercase': return text.toUpperCase();
      case 'lowercase': return text.toLowerCase();
      case 'capitalize': return text.replace(/\b\w/g, l => l.toUpperCase());
      default: return text;
    }
  };
  
  // Measure text to get exact raster dimensions
  const tempCanvas = createCanvas(W, H);
  const tempCtx = tempCanvas.getContext("2d");
  
  // CRITICAL: Use client's exact font string (browser truth)
  const font = meta.previewFontString || canvasFontString(meta.weightCss, meta.fontStyle, fontPx, 'DejaVu Sans');
  tempCtx.font = font;
  tempCtx.textBaseline = 'alphabetic'; // consistent baseline for measurements

  console.log('[raster] Using client previewFontString:', font);
  console.log('[font-parity:server]', {
    ctxFont: tempCtx.font,
    previewFontString: font,
    fontPx,
    fontStyle: meta.fontStyle,
    weightCss: meta.weightCss
  });
  
  // AUDIT: Log pre-wrap font details
  console.info('[AUDIT:SERVER:pre-wrap]', {
    incomingPreviewFontString: meta.previewFontString,
    chosenCtxFont: tempCtx.font,
    fontPx,
    fontStyle: meta.fontStyle,
    weightCss: meta.weightCss
  });
  
  // Helper to measure text width accounting for letter spacing
  const measureTextWidth = (ctx, text, letterSpacing) => {
    if (!letterSpacing || letterSpacing === 0) {
      return ctx.measureText(text).width;
    }
    let totalWidth = 0;
    for (let i = 0; i < text.length; i++) {
      totalWidth += ctx.measureText(text[i]).width;
      if (i < text.length - 1) totalWidth += letterSpacing;
    }
    return totalWidth;
  };
  
  // Use preview's maxLineWidth if provided, otherwise measure naturally
  const maxLineWidth = meta.maxLineWidth ?? (() => {
    let max = 0;
    for (const line of lines) {
      const transformedLine = applyTransform(line);
      const width = measureTextWidth(tempCtx, transformedLine, letterSpacingPx);
      max = Math.max(max, width);
    }
    return max;
  })();
  
  // Validate that lines fit within maxLineWidth and rewrap if needed
  let needsRewrap = false;
  let serverWrappedLines = lines;
  
  for (const line of lines) {
    const transformedLine = applyTransform(line);
    const width = measureTextWidth(tempCtx, transformedLine, letterSpacingPx);
    console.log('[font-parity:measure]', {
      line: transformedLine.substring(0, 20),
      width: Math.round(width),
      maxLineWidth: Math.round(maxLineWidth),
      fits: width <= maxLineWidth + 1
    });
    if (width > maxLineWidth + 1) {  // +1px tolerance
      console.warn(`[raster] Line exceeds maxLineWidth: "${line}" (${width}px > ${maxLineWidth}px)`);
      console.log('[parity:overflow]', {
        line: transformedLine.substring(0, 30),
        width: Math.round(width),
        maxLineWidth: Math.round(maxLineWidth),
        overflow: Math.round(width - maxLineWidth)
      });
      needsRewrap = true;
    }
  }
  
  // Check for mid-word splits using adjacent-line heuristic
  // Mobile Safari's Range API can incorrectly break words mid-word
  for (let i = 0; i < lines.length - 1; i++) {
    const lineA = lines[i].trim();
    const lineB = lines[i + 1].trim();
    
    if (lineA.length > 0 && lineB.length > 0) {
      const endsWithLetterOrDigit = /[a-zA-Z0-9]$/.test(lineA);
      const startsWithLetterOrDigit = /^[a-zA-Z0-9]/.test(lineB);
      const endsWithHyphen = /-$/.test(lineA);
      
      // If line A ends with letter/digit, line B starts with letter/digit, and A doesn't end with hyphen,
      // it's likely a mid-word break
      if (endsWithLetterOrDigit && startsWithLetterOrDigit && !endsWithHyphen) {
        console.log('[raster:word-split]', {
          lineA: lineA.substring(Math.max(0, lineA.length - 20)),
          lineB: lineB.substring(0, Math.min(20, lineB.length)),
          index: i
        });
        needsRewrap = true;
      }
    }
  }
  
  // Server-side rewrap if client lines overflow or have broken words
  let serverTotalTextH = meta.totalTextH;
  let serverRasterH = meta.rasterH;
  
  if (needsRewrap) {
    console.log('[parity:server-rewrap] Client lines overflow or broken words detected, rewrapping with server font');
    console.log('[parity:server-rewrap] Preserving font:', {
      font: tempCtx.font,
      weightCss: meta.weightCss,
      fontStyle: meta.fontStyle
    });
    serverWrappedLines = wrapLinesWithFont(text, maxLineWidth, tempCtx, letterSpacingPx);
    console.log('[parity:server-rewrap]', {
      oldLines: lines.length,
      newLines: serverWrappedLines.length,
      maxLineWidth: Math.round(maxLineWidth)
    });
    
    // ✅ FIX: Recompute geometry from server-wrapped lines
    try {
      const lineSpacingPx = meta.lineSpacingPx || 0;
      serverTotalTextH = serverWrappedLines.length * fontPx + (serverWrappedLines.length - 1) * lineSpacingPx;
      
      // Recompute rasterH using same logic as client (server-side equivalent)
      const cssPaddingTop = meta.padTop || meta.rasterPadding || 24;
      const cssPaddingBottom = meta.padBottom || meta.rasterPadding || 24;
      const shadowBlur = meta.shadowBlur ?? 0;
      const shadowOffsetY = meta.shadowOffsetY ?? 1;
      
      // Server-side computeRasterH equivalent
      serverRasterH = Math.round(
        serverTotalTextH + 
        cssPaddingTop + 
        cssPaddingBottom + 
        Math.max(0, shadowBlur * 2) + 
        Math.max(0, shadowOffsetY)
      );
      
      // Validate recomputed values
      if (!Number.isFinite(serverTotalTextH) || serverTotalTextH <= 0) {
        throw new Error(`Invalid serverTotalTextH: ${serverTotalTextH}`);
      }
      if (!Number.isFinite(serverRasterH) || serverRasterH <= 0) {
        throw new Error(`Invalid serverRasterH: ${serverRasterH}`);
      }
      
      console.log('[parity:server-rewrap:geometry]', {
        oldRasterH: meta.rasterH,
        newRasterH: serverRasterH,
        oldTotalTextH: meta.totalTextH,
        newTotalTextH: serverTotalTextH,
        oldLines: lines.length,
        newLines: serverWrappedLines.length
      });
    } catch (err) {
      console.error('[parity:server-rewrap:ERROR] Geometry recomputation failed:', err);
      // Fallback: use client values (better than crashing)
      serverTotalTextH = meta.totalTextH;
      serverRasterH = meta.rasterH;
      console.warn('[parity:server-rewrap] Using client geometry as fallback due to recomputation error');
    }
  }
  
  // ✅ Use raster dimensions directly (schema validation ensures these exist)
  // Use recomputed values if rewrap occurred
  const padding = meta.rasterPadding;
  const rasterW = meta.rasterW;
  const rasterH = needsRewrap ? serverRasterH : meta.rasterH;

  console.log('[raster] Using client canonical values (no computation):', { 
    padding, rasterW, rasterH 
  });
  
  // Create transparent canvas for caption only
  const rasterCanvas = createCanvas(rasterW, rasterH);
  const ctx = rasterCanvas.getContext("2d");
  ctx.clearRect(0, 0, rasterW, rasterH);
  
  // Setup font
  ctx.font = font;
  ctx.textBaseline = 'top';
  
  // Font comparison and validation
  const normalizeFontString = (str) => str.replace(/\s+/g, ' ').trim();
  const incomingFont = meta.previewFontString || '';
  const actualFont = ctx.font;
  
  console.log('[font-parity:server]', {
    incomingPreviewFontString: incomingFont,
    actualCtxFont: actualFont,
    fontPx,
    fontStyle: meta.fontStyle,
    weightCss: meta.weightCss
  });
  
  // Compare normalized font strings and bail if mismatch
  if (incomingFont && normalizeFontString(incomingFont) !== normalizeFontString(actualFont)) {
    console.error('[font-parity:ERROR] Font mismatch detected:', {
      expected: incomingFont,
      actual: actualFont,
      normalizedExpected: normalizeFontString(incomingFont),
      normalizedActual: normalizeFontString(actualFont)
    });
    return res.status(422).json({
      ok: false,
      reason: 'FONT_MISMATCH',
      detail: `Expected font "${incomingFont}", got "${actualFont}"`
    });
  }
  
  // Freeze typography for forensic parity debugging
  const previewFontString = ctx.font; // freeze exactly what we used
  const previewFontHash = crypto.createHash('sha256').update(previewFontString).digest('hex').slice(0, 16);
  console.log('[raster] Frozen font:', { previewFontString, previewFontHash });
  
  // Calculate Y position BEFORE logging it
  const yPx = meta.yPxFirstLine - padding;
  
  // AUDIT: Log response SSOT
  console.info('[AUDIT:SERVER:response-ssot]', {
    previewFontString,
    previewFontHash,
    rasterHash: '(computed below)',
    yPx_png: yPx,
    rasterW,
    rasterH
  });
  
  // Warn if server changed the font string
  if (meta.previewFontString && meta.previewFontString !== previewFontString) {
    console.warn('[AUDIT:MUTATION:server]', { 
      sent: meta.previewFontString, 
      used: previewFontString 
    });
  }
  
  // Helper to draw text with letter spacing
  const drawTextWithLetterSpacing = (ctx, text, x, y, letterSpacing, method = 'fill') => {
    if (!letterSpacing || letterSpacing === 0) {
      if (method === 'stroke') {
        ctx.strokeText(text, x, y);
      } else {
        ctx.fillText(text, x, y);
      }
      return;
    }
    
    // Manual glyph-by-glyph rendering for letter spacing
    let currX = x;
    for (const ch of text) {
      const w = ctx.measureText(ch).width;
      if (method === 'stroke') {
        ctx.strokeText(ch, currX, y);
      } else {
        ctx.fillText(ch, currX, y);
      }
      currX += w + letterSpacing;
    }
  };
  
  // Draw each line (use server-wrapped lines if rewrap occurred)
  const finalLines = serverWrappedLines;
  
  // Canonical text reference for consistent usage in response/meta
  const canonicalText = text || (finalLines?.join('\n') ?? '');
  
  let currentY = padding;  // Start after top padding
  
  for (let i = 0; i < finalLines.length; i++) {
    const line = applyTransform(finalLines[i]);
    
    // Calculate X position based on alignment
    const lineWidth = measureTextWidth(ctx, line, letterSpacingPx);
    let x;
    switch (textAlign) {
      case 'left':
        x = padding;
        break;
      case 'right':
        x = rasterW - padding - lineWidth;
        break;
      case 'center':
      default:
        x = (rasterW - lineWidth) / 2;
        break;
    }
    
    // For letter-spaced text, we need to start from the left edge
    if (letterSpacingPx && letterSpacingPx !== 0 && textAlign === 'center') {
      x = (rasterW - lineWidth) / 2;
    }
    
    // Render shadow (if enabled)
    if (shadowBlur > 0 || shadowOffsetX !== 0 || shadowOffsetY !== 0) {
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.shadowColor = shadowColor;
      ctx.shadowBlur = shadowBlur;
      ctx.shadowOffsetX = shadowOffsetX;
      ctx.shadowOffsetY = shadowOffsetY;
      ctx.fillStyle = color;
      drawTextWithLetterSpacing(ctx, line, x, currentY, letterSpacingPx, 'fill');
      ctx.restore();
      
      // Reset shadow for stroke/fill
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
    
    // Render stroke (if enabled)
    if (strokePx > 0) {
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokePx;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.miterLimit = 2;
      drawTextWithLetterSpacing(ctx, line, x, currentY, letterSpacingPx, 'stroke');
      ctx.restore();
    }
    
    // Render fill text
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;
    drawTextWithLetterSpacing(ctx, line, x, currentY, letterSpacingPx, 'fill');
    ctx.restore();
    
    currentY += fontPx + (i < finalLines.length - 1 ? meta.lineSpacingPx : 0);
  }
  
  // TEMPORARY: Visual debug markers (remove after verification)
  if (process.env.DEBUG_RASTER_BORDER === '1') {
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, rasterW - 2, rasterH - 2);
    
    // Magenta origin dot
    ctx.fillStyle = 'magenta';
    ctx.fillRect(0, 0, 10, 10);
    
    console.log('[DEBUG] Visual markers added to PNG');
  }
  
  // Optional: Debug parity border (set DEBUG_PARITY=1 in .env)
  if (process.env.DEBUG_PARITY === '1') {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 0, 0, 1)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, rasterW - 2, rasterH - 2);
    ctx.restore();
    console.log('[DEBUG] Red parity border added to raster PNG');
  }
  
  // Convert to data URL
  const rasterDataUrl = rasterCanvas.toDataURL("image/png");
  
  // Compute debug tokens for cleaner output - use actual weight from meta
  const weightUsed = String(meta.weightCss || '400');
  const weightToken = Number(weightUsed) >= 700 ? 'bold' : 'normal';
  const styleToken = normalizeFontStyle(meta.fontStyle || 'normal') === 'italic' ? 'italic' : 'normal';
  
  console.log('[raster] Drew caption PNG with styles:', {
    rasterW,
    rasterH,
    yPx,
    padding,
    lines: finalLines.length,
    maxLineWidth,
    fontStyle: styleToken,
    fontWeight: weightToken,
    letterSpacingPx,
    strokePx,
    strokeColor,
    shadowBlur,
    shadowOffsetX,
    shadowOffsetY,
    shadowColor,
    textAlign,
    color,
    opacity
  });
  
  return {
    rasterUrl: rasterDataUrl,
    rasterW,
    rasterH,
    yPx,
    padding,  // CRITICAL: actual padding used (for parity verification)
    previewFontString,
    previewFontHash,
    // ✅ FIX: Return rewrap info for route handler
    rewrapped: needsRewrap,
    finalLines: serverWrappedLines,
    serverTotalTextH: needsRewrap ? serverTotalTextH : meta.totalTextH,
    serverRasterH: needsRewrap ? serverRasterH : meta.rasterH,
    // Echo back all styles used (helps debugging)
    fontPx,
    lineSpacingPx: meta.lineSpacingPx,
    fontFamily: fontFamilyName,
    weightCss: fontWeight,
    fontStyle,
    color,
    opacity,
    textAlign,
    letterSpacingPx,
    strokePx,
    strokeColor,
    shadowColor,
    shadowBlur,
    shadowOffsetX,
    shadowOffsetY
  };
}

// New overlay format renderer
export async function renderPreviewImage(meta) {
  const W = 1080, H = 1920; // Standard canvas dimensions
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  // Extract positioning from meta
  const x = Math.round((meta.xPct ?? 0.10) * W);
  const y = Math.round(meta.yPct * H);
  const maxWidth = Math.round((meta.wPct ?? 0.80) * W);
  
  // Font setup - use SSOT font registry
  const family = pickFamily(meta.fontFamily);
  const font = canvasFontString(meta.weightCss, meta.fontStyle, meta.sizePx, 'DejaVu Sans');
  const color = toRgba(meta.color, meta.opacity ?? 1);
  
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = meta.textAlign || 'center';
  ctx.textBaseline = 'top';
  
  // Use pre-wrapped lines if provided (SSOT path)
  const lines = meta.lines || (() => {
    // Fallback: wrap text (legacy path)
    const segments = meta.text.split('\n');
    const wrappedLines = [];

    for (const segment of segments) {
      const words = segment.trim().split(/\s+/);
      let line = "";
      
      for (const word of words) {
        const test = line ? line + " " + word : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          wrappedLines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) wrappedLines.push(line);
    }
    return wrappedLines;
  })();
  
  // Calculate line height for drawing
  const lineHeight = meta.sizePx * 1.15;
  
  // Position text using provided yPct (already computed by caller)
  let textY = Math.round(meta.yPct * 1920);  // Use provided anchor
  if (meta.textAlign === 'center') {
    textY = textY - Math.round((lines.length * lineHeight) / 2);
  } else if (meta.textAlign === 'bottom') {
    textY = textY - Math.round(lines.length * lineHeight);
  }
  
  // Draw text with shadow
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 2;
  
  lines.forEach((line, index) => {
    const lineY = textY + (index * lineHeight);
    ctx.fillText(line, x, lineY);
  });
  
  return canvas.toDataURL("image/png");
}

function pickFamily(input) {
  // map UI to canonical family names used during registration
  return input?.includes('Serif') ? 'DejaVu Serif' : 'DejaVu Sans';
}

function toRgba(color, opacity) {
  // Simple color conversion - in production you'd want a proper color parser
  if (color.startsWith('rgb')) {
    return color.replace('rgb', 'rgba').replace(')', `, ${opacity})`);
  }
  return `rgba(255, 255, 255, ${opacity})`;
}

// Helper function for server-side text wrapping with exact font measurement
function wrapLinesWithFont(text, maxLineWidth, ctx, letterSpacingPx = 0) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  
  // Helper to measure text width accounting for letter spacing
  const measureWidth = (str) => {
    if (!letterSpacingPx || letterSpacingPx === 0) {
      return ctx.measureText(str).width;
    }
    let totalWidth = 0;
    for (let i = 0; i < str.length; i++) {
      totalWidth += ctx.measureText(str[i]).width;
      if (i < str.length - 1) totalWidth += letterSpacingPx;
    }
    return totalWidth;
  };
  
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (measureWidth(test) > maxLineWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export default router;
