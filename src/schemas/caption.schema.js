import { z } from 'zod';

export const CaptionMetaSchema = z.object({
  text: z.string().min(1),
  yPct: z.number().min(0).max(1),
  xPct: z.number().min(0).max(1).optional(),
  wPct: z.number().min(0).max(1).optional(),
  fontFamily: z.string().optional(),
  weightCss: z.string().optional(),
  sizePx: z.number().min(8).max(160),
  color: z.string().default('rgb(255,255,255)'),
  opacity: z.number().min(0).max(1).default(1),
  textAlign: z.enum(['left','center','right']).default('center'),
  padding: z.number().min(0).max(64).default(12),
  placement: z.literal('custom'),
  // overlayV2 flag passthrough (non-breaking; optional)
  v2: z.boolean().optional(),
  lineSpacingPx: z.number().min(0).max(240).optional()
});
