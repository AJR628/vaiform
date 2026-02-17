import { replicate } from '../config/replicate.js';

// Pinned version hash for prunaai/hidream-e1.1 (example hash you provided)
const VERSION = '433436facdc1172b6efcb801eb6f345d7858a32200d24e5febaccfb4b44ad66f';

// ensure we pass a proper data URL (some models are picky)
function toDataUrlMaybe(b64) {
  if (!b64) return b64;
  const trimmed = String(b64).trim();
  if (trimmed.startsWith('data:image/')) return trimmed;
  // default to png if no prefix present
  return `data:image/png;base64,${trimmed}`;
}

export default {
  name: 'hidream-pixar',
  mode: 'img2img',
  async invoke({ prompt, refs = [], params = {} }) {
    const imageBase64 = refs[0];

    // Debug logging
    console.log('[pixar-adapter] invoke called with:', {
      hasPrompt: !!prompt,
      refsLength: refs.length,
      hasImage: !!imageBase64,
      imageType: typeof imageBase64,
      imageStartsWith: imageBase64?.substring(0, 50) || 'none',
    });

    // Require an image (schema should already enforce; this is a defensive guard)
    if (!imageBase64) {
      const err = new Error('Pixar requires an input image.');
      err.code = 'BAD_REQUEST';
      throw err;
    }

    // Consolidate defaults to match the sample config you shared
    const DEFAULTS = {
      // already in your payload per logs:
      guidance_scale: 3.5,
      image_guidance_scale: 2,
      num_inference_steps: 28, // aka "steps"
      scheduler: 'K_EULER',
      refiner: 'none',
      output_quality: 80,
      speed_mode: 'Extra Juiced 🚀 (even more speed)',
      // pin the rest explicitly:
      output_format: 'webp',
      seed: -1,
      refine_strength: 0.3,
      clip_cfg_norm: true,
    };

    // Build payload: include 'image' ONLY if present (never null)
    const input = {
      prompt: prompt || 'Convert the image into a 3D animated style.',
      ...DEFAULTS,
      // only include image field if we have a usable value
      ...(imageBase64 ? { image: toDataUrlMaybe(imageBase64) } : {}),
    };

    console.log('[pixar-adapter] sending to Replicate:', {
      hasImage: !!input.image,
      imageType: typeof input.image,
      imageStartsWith: input.image?.substring(0, 50) || 'none',
      inputKeys: Object.keys(input),
      // Debug: show sanitized payload keys (without image data)
      sanitizedKeys: Object.keys(input).filter((key) => key !== 'image'),
    });

    // Create a prediction to poll
    const prediction = await replicate.predictions.create({
      version: VERSION,
      input,
    });

    // IMPORTANT: return just the ID, not the full URL
    return { predictionUrl: prediction.id, directOutput: null };
  },
};
