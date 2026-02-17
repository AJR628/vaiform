import { TTS_DEFAULTS } from '../constants/tts.defaults.js';

export function buildTtsPayload(input) {
  const text = input.text?.trim();
  if (!text) throw new Error('TTS: missing text');

  const voiceId = input.voiceId?.trim();
  if (!voiceId) throw new Error('TTS: missing voiceId');

  const modelId = input.modelId || TTS_DEFAULTS.modelId;
  const outputFormat = input.outputFormat || TTS_DEFAULTS.outputFormat;

  const vsIn = input.voiceSettings || {};
  const voiceSettings = {
    ...TTS_DEFAULTS.voiceSettings,
    ...vsIn,
  };

  return { text, voiceId, modelId, outputFormat, voiceSettings };
}
