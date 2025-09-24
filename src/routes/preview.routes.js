import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { renderCaptionImage } from '../caption/renderCaptionImage.js';
import { uploadPublic } from '../utils/storage.js';
import requireAuth from '../middleware/requireAuth.js';

const router = Router();

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

const PreviewCaptionRequestSchema = z.object({
  jobId: z.string().optional(),
  style: CaptionStyleSchema,
});

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

    const { jobId: providedJobId, style } = parsed.data;
    const jobId = providedJobId || `preview-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

    // Validate text content
    if (!style.text?.trim()) {
      return res.status(400).json({
        ok: false,
        reason: 'EMPTY_TEXT',
        detail: 'Caption text cannot be empty',
      });
    }

    console.log(`[preview] Rendering caption for job ${jobId}, text length: ${style.text.length}`);

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

    return res.status(200).json({
      ok: true,
      data: {
        imageUrl: publicUrl || captionImage.pngPath,
        xPx: captionImage.xPx,
        yPx: captionImage.yPx,
        wPx: captionImage.wPx,
        hPx: captionImage.hPx,
        meta: captionImage.meta,
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
