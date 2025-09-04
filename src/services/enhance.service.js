import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n)));

export async function enhancePrompt(prompt, strength = 0.5) {
  if (!openai.apiKey) {
    return `${prompt} [enhanced:${clamp01(strength)}]`;
  }

  const system = `
    You are a prompt enhancer for an image generation app.
    Return ONE improved prompt only—no explanations.
    Respect the user's subject but clarify details (composition, lighting, camera, style).
    Be concise. Avoid banned/NSFW content and copyrighted names.
  `.trim();

  const user = `
    Original prompt: "${prompt}"
    Enhance it with specificity appropriate to a strength of ${clamp01(strength)}.
    Guidelines:
    - Keep the subject and intent.
    - Add tasteful, descriptive details.
    - Avoid camera or artist names.
  `.trim();

  const resp = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2 + 0.6 * clamp01(strength),
    max_tokens: 120 + Math.round(180 * clamp01(strength)),
  });

  return resp?.choices?.[0]?.message?.content?.trim() || `${prompt} [enhanced:${clamp01(strength)}]`;
}