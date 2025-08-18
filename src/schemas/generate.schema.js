// src/schemas/generate.schema.js
import { z } from 'zod';

const UUID = z.string().uuid({ message: 'requestId must be a valid UUID' });
const Bool = z.coerce.boolean();
const Int = z.coerce.number().int();
const Float = z.coerce.number();

const Prompt = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(5, 'Prompt too short').max(1000, 'Prompt too long'));

const Style = z.string().min(2).max(50);

const HttpsUrl = z.string().url('Must be a valid URL starting with http(s)');
const DataImageUrl = z
  .string()
  .regex(/^data:image\/(png|jpe?g|webp);base64,/i, 'Must be a data URL image (png/jpg/webp)');

// Accept raw base64 strings too (controller can take imageBase64)
const RawBase64 = z.string().min(100, 'Must be a base64-encoded image string');

// ---------- /enhance ----------
export const EnhanceSchema = z
  .object({
    prompt: Prompt,
    strength: Float.min(0).max(1).optional(), // allow optional strength (frontend sends 0.6)
    requestId: UUID.optional(),
  })
  .passthrough();

// ---------- /generate (text-to-image) ----------
// Map { count } -> { numImages } and { upscale } -> { upscaling } BEFORE validating
export const GenerateSchema = z.preprocess(
  (v) => {
    if (v && typeof v === "object") {
      const obj = { ...v };
      if (obj.count != null && obj.numImages == null) obj.numImages = obj.count;
      if (obj.upscale != null && obj.upscaling == null) obj.upscaling = obj.upscale;
      return obj;
    }
    return v;
  },
  z
    .object({
      prompt: Prompt,
      numImages: Int.min(1).max(4).default(1),
      style: Style.default("realistic"),

      // Support either key name; controller can read one or the other
      upscaling: Bool.optional(),
      upscale: Bool.optional(),

      // Advanced options (validated if present)
      guidance: Float.min(0).max(30).optional(),
      steps: Int.min(1).max(150).optional(),
      seed: Int.min(0).max(2147483647).optional(),
      scheduler: z.string().min(2).max(40).optional(),
      refiner: z.string().min(2).max(80).optional(),

      requestId: UUID.optional(),

      // Keep `count` optional for backward compatibility; ignored after preprocess
      count: Int.min(1).max(4).optional(),
    })
    .passthrough()
);

// ---------- /image-to-image ----------
const ImageToImageBase = z
  .object({
    // Some models allow image-only transforms (no prompt)
    prompt: Prompt.optional(),
    style: Style.optional(),

    // Provide one of the following:
    imageUrl: HttpsUrl.optional(),      // https://...
    imageData: DataImageUrl.optional(), // data:image/...;base64,...
    imageBase64: RawBase64.optional(),  // raw base64 string

    // Generation controls
    numImages: Int.min(1).max(4).optional(),
    strength: Float.min(0).max(1).optional(),
    guidance: Float.min(0).max(30).optional(),
    steps: Int.min(1).max(150).optional(),
    seed: Int.min(0).max(2147483647).optional(), // 👈 coerces to integer
    scheduler: z.string().min(2).max(40).optional(),
    refiner: z.string().min(2).max(80).optional(),

    requestId: UUID.optional(),
  })
  .passthrough();

export const ImageToImageSchema = ImageToImageBase.refine(
  (v) => !!(v.imageUrl || v.imageData || v.imageBase64),
  { message: 'Provide imageUrl, imageData, or imageBase64', path: ['image'] }
);

// ---------- /upscale ----------
const UpscaleBase = z
  .object({
    imageUrl: HttpsUrl.optional(),
    imageData: DataImageUrl.optional(),
    mode: z.enum(['2x', '4x']).optional(), // default handled in controller
    requestId: UUID.optional(),
  })
  .passthrough();

export const UpscaleSchema = UpscaleBase.refine((v) => !!(v.imageUrl || v.imageData), {
  message: 'Provide either imageUrl or imageData',
  path: ['image'],
});