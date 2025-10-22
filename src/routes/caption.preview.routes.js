import express from "express";
import pkg from "@napi-rs/canvas";
import crypto from "node:crypto";
import { z } from 'zod';
import { CaptionMetaSchema } from '../schemas/caption.schema.js';
import { bufferToTmp } from '../utils/tmp.js';
import { canvasFontString, normalizeWeight, normalizeFontStyle } from '../utils/font.registry.js';
const { createCanvas } = pkg;

// V3 raster schema (pixel-based with frame coordinates)
const RasterSchema = z.object({
  ssotVersion: z.literal(3),
  mode: z.literal('raster'),
  textRaw: z.string().optional(),  // NEW: raw text with newlines
  text: z.string().min(1, 'Caption text is required'),
  
  // Typography
  fontFamily: z.string().default('DejaVuSans'),
  fontPx: z.coerce.number().int().min(16).max(200),
  lineSpacingPx: z.coerce.number().int().min(0).max(200).default(0),
  letterSpacingPx: z.coerce.number().default(0),
  weightCss: z.string().default('700'),
  fontStyle: z.string().default('normal'),
  textAlign: z.enum(['left', 'center', 'right']).default('center'),
  textTransform: z.string().default('none'),
  
  // Color & effects
  color: z.string().default('rgb(255,255,255)'),
  opacity: z.coerce.number().min(0).max(1).default(1.0),
  strokePx: z.coerce.number().default(0),
  strokeColor: z.string().default('rgba(0,0,0,0.85)'),
  shadowColor: z.string().default('rgba(0,0,0,0.6)'),
  shadowBlur: z.coerce.number().default(12),
  shadowOffsetX: z.coerce.number().default(0),
  shadowOffsetY: z.coerce.number().default(2),
  
  // Geometry (frame-space pixels)
  rasterW: z.coerce.number().int().min(100).max(1080),
  rasterH: z.coerce.number().int().min(50).max(1920),  // ✅ NEW
  yPx_png: z.coerce.number().int().min(0).max(1920),
  rasterPadding: z.coerce.number().int().default(24),
  xExpr_png: z.string().default('(W-overlay_w)/2'),
  
  // Frame dimensions
  frameW: z.coerce.number().int().default(1080),
  frameH: z.coerce.number().int().default(1920),
  
  // Browser-rendered line data (REQUIRED in raster mode)
  lines: z.array(z.string()).min(1, "At least one line required"),
  splitLines: z.coerce.number().int().min(1),  // line count
  totalTextH: z.coerce.number().int().min(1),
  yPxFirstLine: z.coerce.number().int(),
  previewFontString: z.string().optional(),
  
  // Optional legacy fields (ignored but allowed during transition)
  xPct: z.coerce.number().optional(),
  yPct: z.coerce.number().optional(),
  wPct: z.coerce.number().optional(),
});

const router = express.Router();

router.post("/caption/preview", express.json(), async (req, res) => {
  try {
    // Check if this is the new overlay format
    const isOverlayFormat = (
        req.body.placement === 'custom' && 
        req.body.yPct !== undefined
    ) || req.body.v2 === true || req.body.ssotVersion === 3;
    
    if (isOverlayFormat) {
      // Check if this is v3 raster mode
      const isV3Raster = req.body.ssotVersion === 3 && req.body.mode === 'raster';
      console.log('[caption-preview] Using', isV3Raster ? 'V3 RASTER' : 'V2 OVERLAY', 'path');
      
      // Handle V3 raster format
      if (isV3Raster) {
        const parsed = RasterSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ ok: false, reason: "INVALID_INPUT", detail: parsed.error.flatten() });
        }
        
        const data = parsed.data;
        const text = data.text.trim();
        if (!text) {
          return res.status(400).json({ ok: false, reason: "EMPTY_TEXT", detail: "Caption text cannot be empty" });
        }
        
        // ✅ Use client SSOT values - NO RECOMPUTATION
        const fontPx = data.fontPx;
        const lineSpacingPx = data.lineSpacingPx;
        const letterSpacingPx = data.letterSpacingPx || 0;
        const rasterW = data.rasterW;
        const rasterH = data.rasterH;  // ✅ TRUST CLIENT - no recomputation
        const yPx_png = data.yPx_png;  // ✅ TRUST CLIENT - no fallback
        const rasterPadding = data.rasterPadding;  // ✅ TRUST CLIENT - no recomputation
        const lines = data.lines || [];  // ✅ Use client lines (browser-rendered)
        const splitLines = data.splitLines || lines.length;  // Use provided count or derive from lines
        
        console.log('[geom:server]', {
          fontPx, lineSpacingPx, letterSpacingPx, rasterW, rasterH,
          xExpr_png: data.xExpr_png, yPx_png, frameW: data.frameW, frameH: data.frameH,
          lines: Array.isArray(lines) ? lines.length : 'n/a',
          splitLines: splitLines
        });
        
        // Wrap text using client rasterW (reuse V2 pattern)
        const canvas = createCanvas(data.frameW, data.frameH);
        const ctx = canvas.getContext("2d");
        const font = canvasFontString(data.weightCss, data.fontStyle, fontPx);
        ctx.font = font;
        
        // ✅ Use client lines if provided - NO RE-WRAP
        if (lines && lines.length > 0) {
          // Trust client lines exactly - these are browser-rendered line breaks
          console.log('[raster] Using client lines (browser truth):', lines.length, 'lines');
        } else {
          // Reject if missing - client MUST send lines
          console.error('[raster] Client lines missing - cannot proceed');
          return res.status(400).json({ 
            ok: false, 
            reason: "MISSING_SPLITLINES", 
            detail: "Client must send browser-rendered lines in raster mode" 
          });
        }
        
        // ✅ Use client SSOT values - NO RECOMPUTATION
        const totalTextH = data.totalTextH || (lines.length * fontPx + (lines.length - 1) * lineSpacingPx);
        const yPxFirstLine = data.yPxFirstLine || (yPx_png + rasterPadding);
        
        // Call renderCaptionRaster with client SSOT values
        const rasterResult = await renderCaptionRaster({
          text,
          splitLines: lines,
          maxLineWidth: rasterW - (2 * rasterPadding),  // Use client geometry
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
          // ✅ Pass client canonical values to render function
          clientRasterW: rasterW,
          clientRasterH: rasterH,
          clientRasterPadding: rasterPadding,
          W: data.frameW,
          H: data.frameH
        });
        
        // Compute PNG hash
        const pngBuffer = Buffer.from(rasterResult.rasterUrl.split(',')[1], 'base64');
        const rasterHash = crypto.createHash('sha256').update(pngBuffer).digest('hex').slice(0, 16);
        
        // ✅ Use client SSOT values - NO RECOMPUTATION
        console.log('[geom:server] Using client SSOT (no recomputation):', {
          fontPx, lineSpacingPx, letterSpacingPx, rasterW, rasterH,
          yPx_png, rasterPadding, previewFontString: data.previewFontString
        });
        
        // ✅ VALIDATION: Ensure all numeric fields are finite
        const numericFields = { fontPx, lineSpacingPx, letterSpacingPx, rasterW, rasterH, yPx_png, rasterPadding };
        const invalidFields = Object.entries(numericFields)
          .filter(([key, value]) => !Number.isFinite(value))
          .map(([key]) => key);
        
        if (invalidFields.length > 0) {
          console.error('[raster:validation] Invalid numeric fields:', invalidFields);
          return res.status(400).json({ 
            ok: false, 
            reason: "INVALID_NUMERIC_FIELDS", 
            detail: `Invalid fields: ${invalidFields.join(', ')}` 
          });
        }

        // Build complete ssotMeta with all required fields - echo back client values unchanged
        const ssotMeta = {
          ssotVersion: 3,
          mode: 'raster',
          
          // Geometry lock (same as V2)
          frameW: data.frameW,
          frameH: data.frameH,
          bgScaleExpr: "scale='if(gt(a,1080/1920),-2,1080)':'if(gt(a,1080/1920),1920,-2)'",
          bgCropExpr: "crop=1080:1920",
          
          // ✅ Echo client pixels (unchanged) - TRUST CLIENT SSOT
          rasterUrl: rasterResult.rasterUrl,
          rasterW: data.rasterW,  // ✅ Client canonical value
          rasterH: data.rasterH,  // ✅ Client canonical value  
          rasterPadding: data.rasterPadding,  // ✅ Client canonical value
          xExpr_png: data.xExpr_png,  // ✅ Client canonical value
          yPx_png: data.yPx_png,  // ✅ Client canonical value
          
          // Verification hashes - echo back actual server values
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
          
          // Debug info - include lines for client
          lines: lines,  // ✅ Return exact lines used
          splitLines: lines.length,  // ✅ Return count
          lineSpacingPx,
          totalTextH: totalTextH,  // ✅ Use server-computed value for verification
          yPxFirstLine: data.yPx_png + data.rasterPadding,
        };
        
        // Validate echo integrity
        const echoErrors = [];
        if (ssotMeta.rasterW !== data.rasterW) echoErrors.push('rasterW');
        if (ssotMeta.rasterH !== data.rasterH) echoErrors.push('rasterH');
        if (ssotMeta.yPx_png !== data.yPx_png) echoErrors.push('yPx_png');
        if (ssotMeta.fontPx !== data.fontPx) echoErrors.push('fontPx');

        if (echoErrors.length > 0) {
          console.error('[raster:echo] Failed to echo client values:', echoErrors);
          return res.status(500).json({
            ok: false,
            reason: "ECHO_INTEGRITY_FAILED",
            detail: `Server modified: ${echoErrors.join(', ')}`
          });
        }
        
        // Log for verification
        console.log('[v3:raster:complete]', {
          rasterW: rasterResult.rasterW,
          rasterH: rasterResult.rasterH,
          yPx_png: rasterResult.yPx,
          lines: lines.length,
          rasterHash: rasterHash.slice(0, 8) + '...'
        });
        
        console.log('[v3:preview:respond]', { 
          have: Object.keys(ssotMeta),
          required: ['rasterUrl', 'rasterW', 'rasterH', 'rasterPadding', 'yPx_png', 'bgScaleExpr', 'bgCropExpr', 'rasterHash', 'previewFontString', 'totalTextH', 'yPxFirstLine', 'lines', 'splitLines']
        });
        
        return res.status(200).json({
          ok: true,
          data: {
            imageUrl: null,  // V3 raster mode returns PNG in meta.rasterUrl
            wPx: data.frameW,
            hPx: data.frameH,
            xPx: 0,
            yPx: yPxFirstLine,  // Text baseline, not PNG top
            meta: ssotMeta,
          }
        });
      }
      // STEP 0: Sanitize inputs - strip computed fields that should NEVER come from client
      const COMPUTED_FIELDS = [
        "lineSpacingPx", "totalTextH", "totalTextHPx", "yPxFirstLine", "lineHeight",
        "hpct", "hPct", "hPx", "v2", "splitLines", "baselines"
      ];
      COMPUTED_FIELDS.forEach(k => {
        if (req.body && k in req.body) {
          console.log(`[caption-preview-sanitize] Removing computed field from request: ${k}=${req.body[k]}`);
          delete req.body[k];
        }
      });
      
      // Handle new draggable overlay format
      const parsed = CaptionMetaSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, reason: "INVALID_INPUT", detail: parsed.error.flatten() });
      }

      // STEP 1: Extract ONLY safe input fields (no spreading)
      const text = String(parsed.data.text || "").trim();
      const xPct = Number(parsed.data.xPct ?? 0.5);
      const yPct = Number(parsed.data.yPct ?? 0.5);
      const wPct = Number(parsed.data.wPct ?? 0.8);
      const fontPx = Number(parsed.data.sizePx || parsed.data.fontPx || 54);
      
      // Log received styling fields for debugging
      console.log('[caption-preview] Received styling fields:', {
        fontPx: parsed.data.fontPx,
        weightCss: parsed.data.weightCss,
        fontStyle: parsed.data.fontStyle,
        letterSpacingPx: parsed.data.letterSpacingPx,
        textTransform: parsed.data.textTransform,
        strokePx: parsed.data.strokePx,
        strokeColor: parsed.data.strokeColor,
        shadowBlur: parsed.data.shadowBlur,
        shadowOffsetX: parsed.data.shadowOffsetX,
        shadowOffsetY: parsed.data.shadowOffsetY,
        textAlign: parsed.data.textAlign,
        color: parsed.data.color,
        opacity: parsed.data.opacity
      });
      
      // Typography
      const fontFamily = String(parsed.data.fontFamily || 'DejaVuSans');
      const weightCss = String(parsed.data.weightCss || 'normal');
      const fontStyle = parsed.data.fontStyle || 'normal';
      const textAlign = parsed.data.textAlign || 'center';
      const letterSpacingPx = Number(parsed.data.letterSpacingPx ?? 0);
      const textTransform = parsed.data.textTransform || 'none';
      
      // Color & effects
      const color = String(parsed.data.color || 'rgb(255, 255, 255)');
      const opacity = Number(parsed.data.opacity ?? 0.8);
      
      // Stroke (outline)
      const strokePx = Number(parsed.data.strokePx ?? 0);
      const strokeColor = String(parsed.data.strokeColor || 'rgba(0,0,0,0.85)');
      
      // Shadow
      const shadowColor = String(parsed.data.shadowColor || 'rgba(0,0,0,0.6)');
      const shadowBlur = Number(parsed.data.shadowBlur ?? 12);
      const shadowOffsetX = Number(parsed.data.shadowOffsetX ?? 0);
      const shadowOffsetY = Number(parsed.data.shadowOffsetY ?? 2);
      
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
      const font = canvasFontString(weightCss, fontStyle, fontPx);
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
        if (Number.isFinite(parsed.data.lineSpacingPx)) {
          lineSpacingPx = parsed.data.lineSpacingPx;
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
          splitLines: lines,
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
          splitLines: lines,
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
          splitLines: lines,
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
    } else {
      console.log('[caption-preview] Using LEGACY path (placement:', req.body.placement, ', yPct:', req.body.yPct, ', v2:', req.body.v2, ', ssotVersion:', req.body.ssotVersion, ')');
    }
    
    // Legacy format handling
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
        'DejaVuSans': 'DejaVu Sans',
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
      splitLines: lines,
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
          splitLines: lines,
          baselines: undefined,
        }
      }
    });
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

// Smoke test route for quick debugging
router.get("/diag/caption-smoke", async (req, res) => {
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
  const lines = meta.splitLines || [];
  const textAlign = meta.textAlign ?? 'center';
  const letterSpacingPx = meta.letterSpacingPx ?? 0;
  
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
  const font = meta.previewFontString || canvasFontString(meta.weightCss, meta.fontStyle, fontPx);
  tempCtx.font = font;

  console.log('[raster] Using client previewFontString:', font);
  
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
  
  // Validate that lines fit within maxLineWidth
  for (const line of lines) {
    const transformedLine = applyTransform(line);
    const width = measureTextWidth(tempCtx, transformedLine, letterSpacingPx);
    if (width > maxLineWidth + 1) {  // +1px tolerance
      console.warn(`[raster] Line exceeds maxLineWidth: "${line}" (${width}px > ${maxLineWidth}px)`);
    }
  }
  
  // ✅ Use client canonical values if provided (trust client SSOT)
  let padding, rasterW, rasterH;
  
  // ✅ Use client canonical values - NO FALLBACK
  if (!meta.clientRasterW || !meta.clientRasterH || !meta.clientRasterPadding) {
    throw new Error('RASTER: clientRasterW/H/Padding required but missing');
  }

  padding = meta.clientRasterPadding;
  rasterW = meta.clientRasterW;
  rasterH = meta.clientRasterH;

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
  
  // Freeze typography for forensic parity debugging
  const previewFontString = ctx.font;
  const previewFontHash = crypto.createHash('sha256').update(previewFontString).digest('hex').slice(0, 16);
  console.log('[raster] Frozen font:', { previewFontString, previewFontHash });
  
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
  
  // Draw each line
  let currentY = padding;  // Start after top padding
  
  for (let i = 0; i < lines.length; i++) {
    const line = applyTransform(lines[i]);
    
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
    
    currentY += fontPx + (i < lines.length - 1 ? meta.lineSpacingPx : 0);
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
  
  // Convert to data URL
  const rasterDataUrl = rasterCanvas.toDataURL("image/png");
  
  // Calculate Y position: yPxFirstLine is where the text starts
  // But the raster includes padding, so we need to adjust
  const yPx = meta.yPxFirstLine - padding;
  
  // Compute debug tokens for cleaner output
  const weightToken = normalizeWeight(fontWeight) >= 700 ? 'bold' : 'normal';
  const styleToken = normalizeFontStyle(fontStyle) === 'italic' ? 'italic' : 'normal';
  
  console.log('[raster] Drew caption PNG with styles:', {
    rasterW,
    rasterH,
    yPx,
    padding,
    lines: lines.length,
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
async function renderPreviewImage(meta) {
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
  const font = canvasFontString(meta.weightCss, meta.fontStyle, meta.sizePx);
  const color = toRgba(meta.color, meta.opacity ?? 1);
  
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = meta.textAlign || 'center';
  ctx.textBaseline = 'top';
  
  // Use pre-wrapped lines if provided (SSOT path)
  const lines = meta.splitLines || (() => {
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

export default router;
