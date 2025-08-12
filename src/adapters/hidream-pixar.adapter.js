import { replicate } from "../config/replicate.js";

// Pinned version hash for prunaai/hidream-e1.1 (example hash you provided)
const VERSION = "433436facdc1172b6efcb801eb6f345d7858a32200d24e5febaccfb4b44ad66f";

// ensure we pass a proper data URL (some models are picky)
function toDataUrlMaybe(b64) {
  if (!b64) return b64;
  const trimmed = String(b64).trim();
  if (trimmed.startsWith("data:image/")) return trimmed;
  // default to png if no prefix present
  return `data:image/png;base64,${trimmed}`;
}

export default {
  name: "hidream-pixar",
  mode: "img2img",
  async invoke({ prompt, refs = [], params = {} }) {
    const imageBase64 = refs[0];
    if (!imageBase64) throw new Error("imageBase64 is required for Pixar img2img");

    const input = {
      image: toDataUrlMaybe(imageBase64),
      prompt: prompt || "Convert the image into a 3D animated style.",
      guidance_scale: Number(params.guidance ?? 3.0),
      num_inference_steps: Number(params.steps ?? 28),
      seed:
        params.seed != null && `${params.seed}`.trim() !== ""
          ? Number(params.seed)
          : -1,
      output_format: "webp",
      output_quality: 85,
    };

    // Create a prediction to poll
    const prediction = await replicate.predictions.create({
      version: VERSION,
      input,
    });

    // IMPORTANT: return a URL, not just the id
    return { predictionUrl: prediction.urls.get, directOutput: null };
  },
};