import dotenv from 'dotenv';
dotenv.config();

import OpenAI from 'openai';

// Only initialize OpenAI if we have the API key and it's being used
let openai = null;
if (process.env.OPENAI_API_KEY) {
  try {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  } catch (error) {
    console.warn('OpenAI initialization failed:', error.message);
  }
}

export { openai };
