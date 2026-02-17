import { z } from 'zod';

export const VoiceSettingsSchema = z.object({
  stability: z.number().min(0).max(1).default(0.5),
  similarity_boost: z.number().min(0).max(1).default(0.75),
  style: z.number().min(0).max(100).default(0),
  use_speaker_boost: z.boolean().default(true),
});

export const TtsRequestSchema = z.object({
  text: z.string().min(1),
  voiceId: z.string().min(1),
  modelId: z.string().default('eleven_multilingual_v2'),
  outputFormat: z.string().default('mp3_44100_128'),
  voiceSettings: VoiceSettingsSchema.default({}),
});
