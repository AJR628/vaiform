import { z } from "zod";

export const GenerateQuoteSchema = z.object({
  text: z.string().trim().min(1).max(1200),
  tone: z.enum(["motivational","witty","poetic","bold","calm","default"]).optional(),
  maxChars: z.number().int().min(40).max(200).optional(),
}).strict();

export const RemixQuoteSchema = z.object({
  originalText: z.string().trim().min(1).max(1200),
  mode: z.enum(["regenerate", "rephrase", "tone_shift"]),
  targetTone: z.enum(["motivational","witty","poetic","bold","calm","default"]).optional(),
  maxChars: z.number().int().min(40).max(200).optional(),
}).strict();

export const AssetsOptionsSchema = z.object({
  type: z.enum(["images", "videos"]),
  query: z.string().trim().min(1).max(100).optional(),
  page: z.number().int().min(1).max(100).optional(),
  perPage: z.number().int().min(1).max(16).optional(),
}).strict();

export const AiImagesSchema = z.object({
  prompt: z.string().trim().min(4).max(160),
  style: z.enum(["realistic", "creative"]).default("realistic"),
  count: z.number().int().min(1).max(2).default(2),
}).strict();

// Be tolerant of null/undefined author coming from older clients
export const SaveQuoteSchema = z.object({
  text: z.string().trim().min(4).max(280),
  author: z.preprocess((v) => (v == null ? "" : v), z.string().trim().max(80).optional()),
  toneTag: z.string().trim().max(40).optional(),
}).strict();

export default { GenerateQuoteSchema, RemixQuoteSchema, AssetsOptionsSchema, AiImagesSchema, SaveQuoteSchema };


