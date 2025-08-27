// src/schemas/generate.schema.js
import { z } from "zod";

export const GenerateSchema = z.object({
  // Keep BOTH fields optional so older clients keep working.
  // Controller can keep using `style`. We also allow `provider` for future use.
  style: z.enum(["realistic","cartoon","pixar"]).optional(),
  provider: z.enum(["realistic","cartoon","pixar"]).optional(),
  prompt: z.string().trim().min(3, "prompt is required"),
  count: z.union([z.literal(1), z.literal(2), z.literal(4)]).default(1),
  options: z.object({
    image_url: z.string().url().optional(),
    image_base64: z.string().startsWith("data:image/").optional(),
    image: z.any().optional(),
  }).partial().optional(),
}).strict().superRefine((val, ctx) => {
  // Back-compat: resolve the effective kind the same way the controller does.
  const kind = val.provider ?? val.style ?? "realistic";
  if (kind === "pixar") {
    const hasImg = !!(val.options?.image_url || val.options?.image_base64 || val.options?.image);
    if (!hasImg) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "Pixar requires an input image (options.image_url or image_base64).",
      });
    }
  }
});

export const Img2ImgSchema = z.object({
  prompt: z.string().min(1),
  imageUrl: z.string().url(),
  style: z.string().optional(),
  // optional strength/advanced params:
  strength: z.number().min(0).max(1).optional(),
  guidance: z.number().optional(),
  steps: z.number().optional(),
  seed: z.union([z.number(), z.string()]).optional(),
  scheduler: z.string().optional(),
});

export const UpscaleSchema = z.object({
  imageUrl: z.string().url(),
  // optional upscale factor/model flags if used later:
  factor: z.number().optional(),
});