import { replicate } from '../config/replicate.js';

// SDXL pinned version (owner/model:version)
const SDXL_VERSION =
  'stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc';

export default {
  name: 'sdxl',
  mode: 'txt2img',
  defaults: {
    width: 1024, // multiples of 64
    height: 1024,
    guidance_scale: 6.5,
    num_inference_steps: 35,
    scheduler: 'DDIM',
  },
  async invoke({ prompt, params = {} }) {
    if (!prompt) throw new Error('Prompt is required for SDXL');

    // normalize + override defaults safely
    const input = {
      prompt,
      ...this.defaults,
      width: Number.isFinite(+params.width) ? +params.width : this.defaults.width,
      height: Number.isFinite(+params.height) ? +params.height : this.defaults.height,
      guidance_scale: params.guidance_scale ?? params.guidance ?? this.defaults.guidance_scale,
      num_inference_steps:
        params.num_inference_steps ?? params.steps ?? this.defaults.num_inference_steps,
      scheduler: params.scheduler ?? this.defaults.scheduler,
      seed: params.seed === '' || params.seed == null ? undefined : Number(params.seed),
      negative_prompt: params.negative_prompt,
    };

    // strip undefined
    Object.keys(input).forEach((k) => input[k] === undefined && delete input[k]);

    const output = await replicate.run(SDXL_VERSION, { input });
    return { predictionUrl: null, directOutput: output }; // SDXL returns direct output
  },
};
