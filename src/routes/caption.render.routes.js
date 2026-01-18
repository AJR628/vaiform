import express from "express";
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { CaptionMetaSchema } from '../schemas/caption.schema.js';
import requireAuth from '../middleware/requireAuth.js';

const router = express.Router();

const SAFE_TOP = 0.10, SAFE_BOTTOM = 0.90;

const renderRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute
  keyGenerator: (req) => req.user?.uid || ipKeyGenerator(req.ip), // Defensive fallback
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

router.post("/caption/render", requireAuth, renderRateLimit, express.json({ limit: "200kb" }), async (req, res) => {
  try {
    // Check if this is the new overlay format
    const isOverlayFormat = req.body.placement === 'custom' && req.body.yPct !== undefined;
    
    if (isOverlayFormat) {
      // Handle new draggable overlay format
      const parsed = CaptionMetaSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: "INVALID_INPUT", detail: parsed.error.flatten() });
      }
      
      const meta = parsed.data;
      const yPct = Math.min(Math.max(meta.yPct, SAFE_TOP), SAFE_BOTTOM);
      const payload = { ...meta, yPct };
      
      // Log raster mode usage
      if (meta.mode === 'raster') {
        console.log('[render:raster] Using PNG overlay mode', {
          rasterW: meta.rasterW,
          rasterH: meta.rasterH,
          yPx_png: meta.yPx_png,
          xExpr_png: meta.xExpr_png,
          rasterPadding: meta.rasterPadding
        });
        
        // Verify no legacy % fields are used
        if (meta.yPct !== undefined || meta.yPxFirstLine !== undefined) {
          console.warn('[render:raster] Legacy positioning fields present - should not be used');
        }
      }
      
      try {
        // Normalize fontPx → sizePx (renderPreviewImage requires sizePx)
        const sizePx = Number(payload.sizePx ?? payload.fontPx ?? 48);
        if (!Number.isFinite(sizePx) || sizePx < 8 || sizePx > 400) {
          return res.status(400).json({ 
            success: false, 
            error: "INVALID_INPUT", 
            detail: "fontPx/sizePx must be a number between 8 and 400" 
          });
        }

        // Ensure sizePx is set (renderPreviewImage requires it)
        const normalizedPayload = { 
          ...payload, 
          sizePx,
          fontPx: sizePx  // Set both for consistency
        };

        // Ensure required defaults for renderPreviewImage
        if (!normalizedPayload.fontStyle) normalizedPayload.fontStyle = 'normal';
        if (!normalizedPayload.weightCss) normalizedPayload.weightCss = 'bold';
        if (!normalizedPayload.lines && normalizedPayload.text) {
          normalizedPayload.lines = [normalizedPayload.text]; // Fallback if lines missing
        }

        // For now, return the same as preview - in production you'd integrate with your render pipeline
        const { renderPreviewImage } = await import('./caption.preview.routes.js');
        const outputUrl = await renderPreviewImage(normalizedPayload);
        const jobId = `caption_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        return res.json({ 
          success: true, 
          jobId, 
          outputUrl, 
          meta: normalizedPayload 
        });
      } catch (e) {
        console.error('final render failed', e);
        return res.status(500).json({ success: false, error: 'render_failed' });
      }
    }
    
    // Legacy format - redirect to existing render logic
    return res.status(400).json({ 
      success: false, 
      error: "LEGACY_FORMAT", 
      detail: "Please use the new overlay format" 
    });
    
  } catch (e) {
    console.error('caption render error:', e);
    return res.status(500).json({ 
      success: false, 
      error: 'SERVER_ERROR', 
      detail: String(e?.message || e) 
    });
  }
});

export default router;
