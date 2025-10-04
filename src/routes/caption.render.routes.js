import express from "express";
import { CaptionMetaSchema } from '../schemas/caption.schema.js';

const router = express.Router();

const SAFE_TOP = 0.10, SAFE_BOTTOM = 0.90;

router.post("/caption/render", express.json(), async (req, res) => {
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
      
      try {
        // For now, return the same as preview - in production you'd integrate with your render pipeline
        const { renderPreviewImage } = await import('./caption.preview.routes.js');
        const outputUrl = await renderPreviewImage(payload);
        const jobId = `caption_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        return res.json({ 
          success: true, 
          jobId, 
          outputUrl, 
          meta: payload 
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
