import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { renderCaptionImage } from '../caption/renderCaptionImage.js';
import { uploadPublic } from '../utils/storage.js';
import requireAuth from '../middleware/requireAuth.js';
import { normalizeOverlayCaption, computeOverlayPlacement } from '../render/overlay.helpers.js';

const router = Router();

// Legacy v1 schema (pixel-based)
const CaptionStyleSchema = z.object({
  text: z.string().min(1, 'Caption text is required'),
  fontFamily: z.string().default('DejaVuSans'),
  fontWeight: z.union([z.literal(400), z.literal(700)]).default(700),
  fontPx: z.number().int().min(16).max(200).default(44),
  lineSpacingPx: z.number().int().min(0).max(200).default(52),
  align: z.enum(['left', 'center', 'right']).default('center'),
  textAlpha: z.number().min(0).max(1).default(1.0),
  fill: z.string().default('rgba(255,255,255,1)'),
  strokePx: z.number().int().min(0).max(10).default(3),
  strokeColor: z.string().default('rgba(0,0,0,0.85)'),
  shadowX: z.number().int().min(-10).max(10).default(0),
  shadowY: z.number().int().min(-10).max(10).default(2),
  shadowBlur: z.number().min(0).max(20).default(4),
  shadowColor: z.string().default('rgba(0,0,0,0.55)'),
  boxXPx: z.number().int().min(0).max(1080).default(42),
  boxYPx: z.number().int().min(0).max(1920).default(230),
  boxWPx: z.number().int().min(100).max(1080).default(996),
  boxHPx: z.number().int().min(50).max(1920).default(400),
  canvasW: z.number().int().min(100).max(4000).default(1080),
  canvasH: z.number().int().min(100).max(4000).default(1920),
});

// v2 overlay schema (percentage-based, SSOT)
const OverlaySchema = z.object({
  text: z.string().min(1, 'Caption text is required'),
  xPct: z.coerce.number().min(0).max(1).default(0.5),
  yPct: z.coerce.number().min(0).max(1).default(0.5),
  wPct: z.coerce.number().min(0).max(1).default(0.8),
  hPct: z.coerce.number().min(0).max(1).default(0.3),
  fontPx: z.coerce.number().int().min(16).max(200).optional(),
  sizePx: z.coerce.number().int().min(16).max(200).optional(), // alias
  lineHeight: z.coerce.number().min(0.9).max(2.0).default(1.15),
  lineSpacingPx: z.coerce.number().int().min(0).max(200).default(0),
  align: z.enum(['left', 'center', 'right']).default('center'),
  color: z.string().default('#ffffff'),
  opacity: z.coerce.number().min(0).max(1).default(1.0),
  fontFamily: z.string().default('DejaVuSans'),
  weightCss: z.string().default('normal'),
  showBox: z.boolean().default(false),
  v2: z.boolean().optional(), // flag to indicate v2 format
});

const PreviewCaptionRequestSchema = z.union([
  // v1 format
  z.object({
    jobId: z.string().optional(),
    style: CaptionStyleSchema,
    v2: z.literal(false).optional(),
  }),
  // v2 format (direct overlay object)
  OverlaySchema.extend({
    jobId: z.string().optional(),
    v2: z.literal(true).optional(),
  }),
]);

/**
 * POST /api/preview/caption
 * Generate a caption PNG for preview purposes
 */
router.post('/caption', requireAuth, async (req, res) => {
  try {
    const parsed = PreviewCaptionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        reason: 'INVALID_INPUT',
        detail: parsed.error.flatten(),
      });
    }

    const data = parsed.data;
    const jobId = data.jobId || `preview-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    
    // Detect v1 vs v2 format
    const isV2 = data.v2 === true || !data.style;
    
    let overlay, style;
    
    if (isV2) {
      // v2 format: normalize overlay and convert to rendering style
      overlay = normalizeOverlayCaption(data);
      
      if (!overlay || !overlay.text?.trim()) {
        return res.status(400).json({
          ok: false,
          reason: 'EMPTY_TEXT',
          detail: 'Caption text cannot be empty',
        });
      }
      
      // Convert overlay to rendering style (pixel-based for renderCaptionImage)
      const W = 1080, H = 1920;
      style = {
        text: overlay.text,
        fontFamily: overlay.fontFamily,
        fontWeight: overlay.weightCss === 'bold' || overlay.weightCss === '700' ? 700 : 400,
        fontPx: overlay.fontPx,
        lineSpacingPx: overlay.lineSpacingPx,
        align: overlay.align,
        textAlpha: overlay.opacity,
        fill: overlay.color,
        // Convert percentages to pixels for legacy renderer
        boxXPx: Math.round(overlay.xPct * W),
        boxYPx: Math.round(overlay.yPct * H),
        boxWPx: Math.round(overlay.wPct * W),
        boxHPx: Math.round(overlay.hPct * H),
        canvasW: W,
        canvasH: H,
        // Defaults for stroke/shadow
        strokePx: 3,
        strokeColor: 'rgba(0,0,0,0.85)',
        shadowX: 0,
        shadowY: 2,
        shadowBlur: 4,
        shadowColor: 'rgba(0,0,0,0.55)',
      };
      
      console.log(`[preview:v2] Rendering overlay caption for job ${jobId}:`, {
        text: overlay.text.substring(0, 50),
        xPct: overlay.xPct,
        yPct: overlay.yPct,
        wPct: overlay.wPct,
        hPct: overlay.hPct,
        fontPx: overlay.fontPx
      });
    } else {
      // v1 format: use style directly
      style = data.style;
      
      if (!style.text?.trim()) {
        return res.status(400).json({
          ok: false,
          reason: 'EMPTY_TEXT',
          detail: 'Caption text cannot be empty',
        });
      }
      
      // Convert v1 to overlay for SSOT response
      const W = style.canvasW || 1080;
      const H = style.canvasH || 1920;
      overlay = {
        text: style.text,
        xPct: style.boxXPx / W,
        yPct: style.boxYPx / H,
        wPct: style.boxWPx / W,
        hPct: style.boxHPx / H,
        fontPx: style.fontPx,
        lineSpacingPx: style.lineSpacingPx,
        align: style.align,
        color: style.fill,
        opacity: style.textAlpha,
        fontFamily: style.fontFamily,
        weightCss: style.fontWeight === 700 ? 'bold' : 'normal',
      };
      
      console.log(`[preview:v1] Rendering legacy caption for job ${jobId}, text length: ${style.text.length}`);
    }

    // Render the caption image
    const captionImage = await renderCaptionImage(jobId, style);

    // Upload to storage for public access
    let publicUrl = null;
    try {
      const uid = req.user?.uid;
      const storagePath = `previews/${uid}/${jobId}/caption.png`;
      const uploadResult = await uploadPublic(captionImage.pngPath, storagePath, 'image/png');
      publicUrl = uploadResult.publicUrl;
      captionImage.publicUrl = publicUrl;
    } catch (uploadErr) {
      console.warn(`[preview] Upload failed for ${jobId}:`, uploadErr.message);
      // Continue without public URL - client will need to handle local file
    }

    // Compute SSOT placement for response
    const W = style.canvasW || 1080;
    const H = style.canvasH || 1920;
    const placement = computeOverlayPlacement(overlay, W, H);
    
    // Log placement details for verification
    console.log(`[preview] Placement computed:`, {
      xPct: overlay.xPct.toFixed(3),
      yPct: overlay.yPct.toFixed(3),
      wPct: overlay.wPct.toFixed(3),
      hPct: overlay.hPct.toFixed(3),
      fontPx: placement.fontPx,
      totalTextH: placement.totalTextH,
      computedY: placement.y
    });

    // Return normalized SSOT response
    return res.status(200).json({
      ok: true,
      data: {
        imageUrl: publicUrl || captionImage.pngPath,
        wPx: W,
        hPx: H,
        meta: {
          // SSOT fields (percentages as 0..1)
          text: overlay.text,
          xPct: overlay.xPct,
          yPct: overlay.yPct,
          wPct: overlay.wPct,
          hPct: overlay.hPct,
          fontPx: overlay.fontPx,
          lineHeight: overlay.lineHeight || 1.15,
          lineSpacingPx: overlay.lineSpacingPx,
          align: overlay.align,
          color: overlay.color,
          opacity: overlay.opacity,
          fontFamily: overlay.fontFamily,
          weightCss: overlay.weightCss,
          // Computed placement data
          totalTextH: placement.totalTextH,
          splitLines: captionImage.meta.splitLines,
          baselines: captionImage.meta.baselines,
        },
      },
    });
  } catch (error) {
    console.error('[preview] Caption render failed:', error.message);
    
    let reason = 'RENDER_FAILED';
    let detail = error.message;
    
    if (error.message.includes('empty')) {
      reason = 'EMPTY_TEXT';
    } else if (error.message.includes('Font')) {
      reason = 'FONT_ERROR';
    }

    return res.status(500).json({
      ok: false,
      reason,
      detail,
    });
  }
});

export default router;
