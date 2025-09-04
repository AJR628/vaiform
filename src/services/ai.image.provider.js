export async function generateAIImage({ prompt, style }) {
  const hasKey = !!(process.env.OPENAI_API_KEY || process.env.STABILITY_API_KEY || process.env.REPLICATE_API_TOKEN);
  if (!hasKey) {
    return { path: null, reason: "NOT_CONFIGURED" };
  }
  // Future implementation: call provider to generate an image and return a local path
  // For now, we intentionally do nothing in this diff.
  return { path: null, reason: "NOT_IMPLEMENTED" };
}

export default { generateAIImage };


