import { z } from 'zod';

export const checkoutSessionSchema = z.object({
  priceId: z.string().min(1),
  quantity: z.number().int().positive().max(99).optional(),
  credits: z.number().int().positive().max(100000).optional(),
});

export const subscriptionSessionSchema = z.object({
  priceId: z.string().min(1),
  credits: z.number().int().positive().max(100000).optional(),
});
