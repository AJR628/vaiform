import { replicate } from '../config/replicate.js';

const ESRGAN_VERSION = 'nightmareai/real-esrgan:latest';

export default {
  name: 'realesrgan',
  mode: 'upscale',
  async invoke({ refs = [] }) {
    const imageUrl = refs[0];
    const prediction = await replicate.predictions.create({
      version: ESRGAN_VERSION,
      input: { image: imageUrl },
    });
    return { predictionUrl: prediction.id };
  },
};
