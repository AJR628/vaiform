import { getAdapter } from './model-registry.service.js';
import { saveImageFromUrl } from './storage.service.js';

/**
 * Generate an AI image using the model registry (ideogram by default).
 * Returns { url } or, if uid/jobId provided, persists to storage and returns { url: publicUrl }.
 */
export async function generateAIImage({ prompt, style = 'realistic', params = {}, uid = null, jobId = null, index = 0 }) {
  // [AI_IMAGES] Provider disabled for v1 – should not be used
  throw new Error("AI_IMAGES_DISABLED: AI image generation is disabled in this version of Vaiform.");
  
  // [AI_IMAGES] Legacy implementation (disabled for v1)
  /* eslint-disable no-unreachable */
  const hasKey = !!(process.env.REPLICATE_API_TOKEN);
  if (!hasKey) {
    return { url: null, reason: "NOT_CONFIGURED" };
  }

  const adapter = getAdapter(style === 'pixar' ? 'pixar' : style === 'cartoon' ? 'cartoon' : 'realistic');

  // Map our slider to ideogram style types if using the ideogram adapter
  const effectiveParams = { ...params };
  if (style === 'creative' && !effectiveParams.style_type) {
    effectiveParams.style_type = 'Illustration';
  }

  const { directOutput } = await adapter.invoke({ prompt, params: effectiveParams });
  const url = Array.isArray(directOutput) ? directOutput[0] : (directOutput?.[0] || directOutput);
  if (!url) return { url: null, reason: 'NO_OUTPUT' };

  // Persist if a uid/jobId were provided
  if (uid && jobId) {
    try {
      const saved = await saveImageFromUrl(uid, jobId, url, { index, recompress: false });
      return { url: saved.publicUrl };
    } catch (e) {
      // Fall back to provider URL if save fails
      return { url };
    }
  }
  return { url };
}

export default { generateAIImage };


