// src/validation/schemas.js
import { z } from 'zod';

export const enhanceSchema = z.object({
  prompt: z.string().min(3, 'prompt too short').max(2000, 'prompt too long'),
  strength: z.number().min(0).max(1).optional(),
});

export const generateSchema = z.object({
  prompt: z.string().min(3).max(2000),
  count: z.number().int().min(1).max(4).default(1),
  upscaling: z.boolean().optional(),
  style: z.string().optional(),
  // add other optional flags you support (guidance, steps, seed, scheduler, etc.)
});
