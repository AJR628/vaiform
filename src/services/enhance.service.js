// src/services/enhance.service.js
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

export async function enhancePrompt(prompt, strength = 0.5) {
  if (!openai.apiKey) {
    return `${prompt} [enhanced:${clamp01(strength)}]`;
  }

  const temperature = 0.2 + 0.6 * clamp01(strength);
  const maxTokens = 120 + Math.round(180 * clamp01(strength));

  const system = `You are a prompt enhancer for an image generation app.`;
  const user = `Original prompt: "${prompt}"`;

  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens,
    });

    return resp?.choices?.[0]?.message?.content?.trim() || prompt;
  } catch (err) {
    console.error('Enhance service error:', err);
    return `${prompt} [enhanced:failed]`;
  }
}
