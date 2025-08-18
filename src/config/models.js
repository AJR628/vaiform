// src/config/models.js

// Optional env overrides so you can change without code edits
const HIDREAM_MODEL =
  process.env.REP_MODEL_HIDREAM
  || "prunaai/hidream-e1.1:433436facdc1172b6efcb801eb6f345d7858a32200d24e5febaccfb4b44ad66f"; // pinned allowed

const SDXL_MODEL =
  process.env.REP_MODEL_SDXL
  || "stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc";     // pinned allowed

export const MODEL_REGISTRY = {
  // — TXT→IMG (Ideogram) — using slug (no version needed)
  "ideogram-v3-turbo": {
    provider: "replicate",
    kind: "txt2img",
    maxImages: 4,
    creditCostPerImage: 20,
    providerRef: { model: "ideogram-ai/ideogram-v3-turbo" },
    defaults: { steps: 28, guidance: 4.5, aspect_ratio: "1:1" },
  },

  // — IMG→IMG (HiDream “Pixar/3D”)
  "hidream-pixar": {
    provider: "replicate",
    kind: "img2img",
    maxImages: 4,
    creditCostPerImage: 20,
    requiresImage: true,
    providerRef: { model: HIDREAM_MODEL }, // slug or slug:version
    defaults: {
      speed_mode: "Extra Juiced 🚀 (even more speed)",
      guidance_scale: 3.5,
      image_guidance_scale: 2,
      output_quality: 80,
      // strength: 0.6, // include if your chosen HiDream variant supports it
    },
  },

  // — TXT→IMG (SDXL)
  "sdxl": {
    provider: "replicate",
    kind: "txt2img",
    maxImages: 4,
    creditCostPerImage: 20,
    providerRef: { model: SDXL_MODEL }, // slug or slug:version
    defaults: {
      width: 768,
      height: 768,
      refine: "expert_ensemble_refiner",
      apply_watermark: false,
      num_inference_steps: 25,
    },
  },
};

// Styles your UI can send
export const STYLE_PRESETS = {
  realistic:  { model: "ideogram-v3-turbo" }, // txt→img default
  sdxl:       { model: "sdxl" },              // txt→img (SDXL)
  pixar:      { model: "hidream-pixar" },     // img→img default
  "pixar-3d": { model: "hidream-pixar" },     // alias for safety
};

export function resolveStyle(style) {
  const preset = STYLE_PRESETS[style || "realistic"];
  const modelId = preset?.model || "ideogram-v3-turbo";
  const entry = MODEL_REGISTRY[modelId];
  const params = { ...(entry?.defaults || {}), ...(preset?.overrides || {}) };
  return { modelId, entry, params };
}
