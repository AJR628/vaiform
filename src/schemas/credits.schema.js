import { z } from 'zod';

export const balanceQuerySchema = z.object({ 
  email: z.string().email() 
});

export const grantBodySchema = z.object({
  email: z.string().email(),
  credits: z.number().int().positive().max(100000),
});
