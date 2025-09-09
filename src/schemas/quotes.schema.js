import { z } from "zod";

export const GenerateQuoteSchema = z.object({
  text: z.string().trim().min(1).max(1200),
  tone: z.enum(["motivational","witty","poetic","bold","calm","default"]).optional(),
  maxChars: z.number().int().min(40).max(200).optional(),
}).strict();

export default { GenerateQuoteSchema };


