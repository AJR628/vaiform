import { openai } from "../config/env.js";

export async function checkText(prompt) {
  const mod = await openai.moderations.create({ input: prompt });
  if (mod.results?.[0]?.flagged) {
    throw new Error("Inappropriate prompt detected.");
  }
}