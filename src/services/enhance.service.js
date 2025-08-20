// src/services/enhance.service.js
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n)));

export async function enhancePrompt(prompt, strength = 0.5) {
  if (!openai.apiKey) {
    return `${prompt} [enhanced:${clamp01(strength)}]`;
  }

  const s = clamp01(strength);

  const temperature = 0.2 + 0.6 * s;
  const maxTokens = 120 + Math.round(180 * s);

  const system = `
You are a prompt enhancer for an image generation app.
Return ONE improved prompt only—no explanations.
Respect the user's subject but clarify details (composition, lighting, camera, style).
  `.trim();

  const user = `
Original prompt: "${prompt}"

Enhance it with specificity appropriate to a strength of ${s}.
  `.trim();

  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
    });

    const text = resp?.choices?.[0]?.message?.content?.trim() || `${prompt} [enhanced:${s}]`;

    return text.replace(/\s*\n+\s*/g, ' ');
  } catch (err) {
    console.error('Enhance service error:', err);
    return `${prompt} [enhanced:${s}]`;
  }
}
