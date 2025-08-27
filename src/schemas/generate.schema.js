// src/schemas/generate.schema.js
import { z } from "zod";

export const GenerateSchema = z.object({
  prompt: z.string().min(3, "prompt must be at least 3 characters"),
  count: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  style: z.string().optional(),
  upscale: z.boolean().optional(),
  // allow future advanced params without failing:
  guidance: z.number().optional(),
  steps: z.number().optional(),
  seed: z.union([z.number(), z.string()]).optional(),
  scheduler: z.string().optional(),
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