import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function enhancePrompt(prompt, strength = 0.5) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5 + strength * 0.5
  });

  return response.choices[0].message.content.trim();
}