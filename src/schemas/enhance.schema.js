import { z } from "zod";

export const EnhanceSchema = z.object({
  prompt: z
    .string()
    .min(3, "prompt must be at least 3 characters")
    .max(2000, "prompt too long"),
  strength: z
    .number()
    .min(0, "strength must be >= 0")
    .max(1, "strength must be <= 1")
    .optional()
    .default(0.6),
}).strict(); // fail on unknown keys (helps catch typos)
