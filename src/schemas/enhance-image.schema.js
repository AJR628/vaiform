import { z } from 'zod';

export const EnhanceImageSchema = z.object({
  prompt: z.string().min(1),
  strength: z.number().min(0).max(1).optional(),
});