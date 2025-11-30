/**
 * Voice presets for story TTS
 * Each preset includes voiceId and tuned voiceSettings for specific emotions
 * Voice IDs should be configured via environment variables or use ElevenLabs default voices
 */

export const VOICE_PRESETS = {
  // Male voices
  male_calm: {
    name: "Male - Calm",
    gender: "male",
    emotion: "calm",
    voiceId: process.env.ELEVEN_VOICE_ID_MALE_CALM || process.env.ELEVEN_VOICE_ID || "pNInz6obpgDQGcFmaJgB", // Default to Adam if not set
    voiceSettings: {
      stability: 0.6,
      similarity_boost: 0.75,
      style: 0.2,
      use_speaker_boost: true
    }
  },
  male_energetic: {
    name: "Male - Energetic",
    gender: "male",
    emotion: "energetic",
    voiceId: process.env.ELEVEN_VOICE_ID_MALE_ENERGETIC || process.env.ELEVEN_VOICE_ID || "pNInz6obpgDQGcFmaJgB",
    voiceSettings: {
      stability: 0.4,
      similarity_boost: 0.8,
      style: 0.6,
      use_speaker_boost: true
    }
  },
  male_dramatic: {
    name: "Male - Dramatic",
    gender: "male",
    emotion: "dramatic",
    voiceId: process.env.ELEVEN_VOICE_ID_MALE_DRAMATIC || process.env.ELEVEN_VOICE_ID || "pNInz6obpgDQGcFmaJgB",
    voiceSettings: {
      stability: 0.5,
      similarity_boost: 0.85,
      style: 0.8,
      use_speaker_boost: true
    }
  },
  male_friendly: {
    name: "Male - Friendly",
    gender: "male",
    emotion: "friendly",
    voiceId: process.env.ELEVEN_VOICE_ID_MALE_FRIENDLY || process.env.ELEVEN_VOICE_ID || "pNInz6obpgDQGcFmaJgB",
    voiceSettings: {
      stability: 0.55,
      similarity_boost: 0.7,
      style: 0.3,
      use_speaker_boost: true
    }
  },
  
  // Female voices
  female_calm: {
    name: "Female - Calm",
    gender: "female",
    emotion: "calm",
    voiceId: process.env.ELEVEN_VOICE_ID_FEMALE_CALM || process.env.ELEVEN_VOICE_ID || "EXAVITQu4vr4xnSDxMaL", // Default to Bella if not set
    voiceSettings: {
      stability: 0.6,
      similarity_boost: 0.75,
      style: 0.2,
      use_speaker_boost: true
    }
  },
  female_energetic: {
    name: "Female - Energetic",
    gender: "female",
    emotion: "energetic",
    voiceId: process.env.ELEVEN_VOICE_ID_FEMALE_ENERGETIC || process.env.ELEVEN_VOICE_ID || "EXAVITQu4vr4xnSDxMaL",
    voiceSettings: {
      stability: 0.4,
      similarity_boost: 0.8,
      style: 0.6,
      use_speaker_boost: true
    }
  },
  female_dramatic: {
    name: "Female - Dramatic",
    gender: "female",
    emotion: "dramatic",
    voiceId: process.env.ELEVEN_VOICE_ID_FEMALE_DRAMATIC || process.env.ELEVEN_VOICE_ID || "EXAVITQu4vr4xnSDxMaL",
    voiceSettings: {
      stability: 0.5,
      similarity_boost: 0.85,
      style: 0.8,
      use_speaker_boost: true
    }
  },
  female_friendly: {
    name: "Female - Friendly",
    gender: "female",
    emotion: "friendly",
    voiceId: process.env.ELEVEN_VOICE_ID_FEMALE_FRIENDLY || process.env.ELEVEN_VOICE_ID || "EXAVITQu4vr4xnSDxMaL",
    voiceSettings: {
      stability: 0.55,
      similarity_boost: 0.7,
      style: 0.3,
      use_speaker_boost: true
    }
  }
};

/**
 * Get a voice preset by key
 * @param {string} presetKey - Key like "male_calm" or "female_energetic"
 * @returns {object} Voice preset object
 */
export function getVoicePreset(presetKey) {
  if (!presetKey || !VOICE_PRESETS[presetKey]) {
    // Default to calm male if not specified
    return VOICE_PRESETS.male_calm;
  }
  return VOICE_PRESETS[presetKey];
}

/**
 * Get default voice preset based on story tone (if available)
 * Falls back to male_calm
 */
export function getDefaultVoicePreset() {
  return VOICE_PRESETS.male_calm;
}

/**
 * List all available preset keys
 */
export function listVoicePresets() {
  return Object.keys(VOICE_PRESETS);
}

export default {
  VOICE_PRESETS,
  getVoicePreset,
  getDefaultVoicePreset,
  listVoicePresets
};

