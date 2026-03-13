import { z } from 'zod'

export const startCheckoutSchema = z
  .object({
    plan: z.enum(['creator', 'pro']),
  })
  .strict()
