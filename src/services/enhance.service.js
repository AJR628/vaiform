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
...`.trim();
  const user = `
...`.trim();

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

    const text = resp?.choices?.[0]?.message?.content?.trim() || `${prompt} [enhanced:${s}]`;

    return text.replace(/\s*\n+\s*/g, ' ');
  } catch (err) {
    console.error('Enhance service error:', err?.message || err);
    return `${prompt} [enhanced:${s}]`;
  }
}