import { z } from 'zod';

export const CaptionMetaSchema = z
  .object({
    // Core text
    text: z.string().min(1),

    // Geometry (v3)
    xPct: z.number().min(0).max(1).optional(),
    yPct: z.number().min(0).max(1),
    wPct: z.number().min(0).max(1).optional(),
    yPx: z.number().optional(), // top-of-raster
    yPxFirstLine: z.number().optional(),
    totalTextH: z.number().min(0).optional(),
    lineSpacingPx: z.number().min(0).max(400).optional(),
    internalPadding: z.number().optional(),
    lines: z.array(z.string()).min(1).optional(),
    fontPx: z.number().min(8).max(400).optional(),
    sizePx: z.number().min(8).max(400).optional(), // alias for fontPx
    xExpr: z.string().optional(),

    // Raster mode (v3)
    ssotVersion: z.number().optional(),
    mode: z.enum(['raster', 'drawtext']).optional(),
    rasterUrl: z.string().optional(),
    rasterW: z.number().optional(),
    rasterH: z.number().optional(),

    // Typography
    fontFamily: z.string().optional(),
    weightCss: z.union([z.string(), z.number()]).optional(),
    fontStyle: z.enum(['normal', 'italic', 'oblique']).optional(),
    textAlign: z.enum(['left', 'center', 'right']).default('center'),
    letterSpacingPx: z.number().optional(),
    textTransform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']).optional(),

    // Color & effects
    color: z.string().default('rgb(255,255,255)'),
    opacity: z.number().min(0).max(1).default(1),

    // Stroke (outline)
    strokePx: z.number().min(0).optional(),
    strokeColor: z.string().optional(),

    // Shadow
    shadowColor: z.string().optional(),
    shadowBlur: z.number().min(0).optional(),
    shadowOffsetX: z.number().optional(),
    shadowOffsetY: z.number().optional(),

    // Layout
    padding: z.number().min(0).max(64).default(12),
    placement: z.literal('custom').optional(),

    // Flags
    v2: z.boolean().optional(),
  })
  .passthrough(); // Allow additional fields for forward compatibility
