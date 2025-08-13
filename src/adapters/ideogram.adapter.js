// src/adapters/ideogram.adapter.js
import { replicate } from '../config/replicate.js';

// Version-pin avoids schema mismatches that can cause 422s.
// You can update this hash later from the model's API tab on Replicate.
const MODEL =
  'ideogram-ai/ideogram-v3-turbo:32a9584617b239dd119c773c8c18298d310068863d26499e6199538e9c29a586';

export default {
  name: 'ideogram-v3-turbo',
  mode: 'txt2img',
  // These defaults are valid per the model’s schema.
  // (aspect_ratio/resolution/style_type/magic_prompt_option are supported.)
  defaults: {
    resolution: 'None',
    style_type: 'None',
    aspect_ratio: '3:2',
    magic_prompt_option: 'Auto',
  },

  async invoke({ prompt, params = {} }) {
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt is required for ideogram-v3-turbo');
    }

    // Normalize incoming params -> model schema fields
    const input = {
      prompt,
      ...this.defaults,
      // Allow callers to override defaults with either snake_case or camelCase:
      aspect_ratio: params.aspect_ratio ?? params.aspectRatio ?? this.defaults.aspect_ratio,
      resolution: params.resolution ?? this.defaults.resolution,
      style_type: params.style_type ?? params.styleType ?? this.defaults.style_type,
      magic_prompt_option:
        params.magic_prompt_option ?? params.magicPrompt ?? this.defaults.magic_prompt_option,
      // Optional extras (only sent if provided)
      // negative_prompt: params.negative_prompt,
      // seed: params.seed ?? null,
    };

    // Remove undefined so we don’t accidentally send bad keys
    Object.keys(input).forEach((k) => input[k] === undefined && delete input[k]);

    let output;
    try {
      // Pinning version avoids 422 when Replicate updates “latest”
      output = await replicate.run(MODEL, { input });
    } catch (e) {
      // Surface server message when available
      const msg = e?.message || e?.error || 'Replicate run failed';
      console.error('❌ Ideogram run error:', msg);
      throw e;
    }

    // Ideogram usually returns direct output (array of URLs). We keep the shape your controller expects.
    return { predictionUrl: null, directOutput: output };
  },
};
