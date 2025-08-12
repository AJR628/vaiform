import { z } from "zod";

const UUID = z.string().uuid({ message: "requestId must be a valid UUID" });
const Bool = z.coerce.boolean();
const Int = z.coerce.number().int();
const Float = z.coerce.number();

const Prompt = z.string()
  .transform(s => s.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(5, "Prompt too short").max(1000, "Prompt too long"));

const Style = z.string().min(2).max(50);

const HttpsUrl = z.string().url("Must be a valid URL starting with http(s)");
const DataImageUrl = z.string().regex(
  /^data:image\/(png|jpe?g|webp);base64,/i,
  "Must be a data URL image (png/jpg/webp)"
);

// ---------- /enhance ----------
export const EnhanceSchema = z.object({
  prompt: Prompt,
  requestId: UUID.optional(),
}).passthrough();

// ---------- /generate ----------
export const GenerateSchema = z.object({
  prompt: Prompt,
  numImages: Int.min(1).max(4),
  style: Style,
  upscaling: Bool.optional(),

  // Advanced settings (optional; validated if present)
  guidance: Float.min(0).max(30).optional(),
  steps: Int.min(1).max(150).optional(),
  seed: Int.min(0).max(2147483647).optional(),
  scheduler: z.string().min(2).max(40).optional(),

  requestId: UUID.optional(),
}).passthrough();

// ---------- /image-to-image ----------
const ImageToImageBase = z.object({
  prompt: Prompt.optional(), // some models allow image-only transforms
  style: Style.optional(),

  // Provide either imageUrl OR imageData (data URL)
  imageUrl: HttpsUrl.optional(),
  imageData: DataImageUrl.optional(),
  strength: Float.min(0).max(1).optional(),

  requestId: UUID.optional(),
}).passthrough();

export const ImageToImageSchema = ImageToImageBase.refine(
  v => !!(v.imageUrl || v.imageData),
  { message: "Provide either imageUrl or imageData", path: ["image"] }
);

// ---------- /upscale ----------
const UpscaleBase = z.object({
  imageUrl: HttpsUrl.optional(),
  imageData: DataImageUrl.optional(),
  mode: z.enum(["2x", "4x"]).optional(), // default handled in controller
  requestId: UUID.optional(),
}).passthrough();

export const UpscaleSchema = UpscaleBase.refine(
  v => !!(v.imageUrl || v.imageData),
  { message: "Provide either imageUrl or imageData", path: ["image"] }
);