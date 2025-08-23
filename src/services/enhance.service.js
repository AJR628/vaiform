// src/services/enhance.service.js
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function enhancePrompt(prompt, strength) {
  if (!openai.apiKey) {
    return `${prompt} [enhanced]`;
  }

  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      { role: "system", content: "Enhance the prompt creatively." },
      { role: "user", content: prompt }
    ],
    temperature: strength || 0.5
  });

  return response.choices[0].message.content;
}
