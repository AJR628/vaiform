import dotenv from 'dotenv';
dotenv.config();

import OpenAI from 'openai';

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Feature flags
export const CAPTION_OVERLAY = (process.env.CAPTION_OVERLAY ?? '1') === '1';