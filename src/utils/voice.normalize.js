/**
 * Voice Settings Normalization (SSOT)
 * Ensures consistent voice settings across preview and render
 */

/**
 * Normalize a value to 0-1 range
 * Handles both 0-1 and 0-100 input scales
 */
export function norm01(value) {
  const num = Number(value);
  if (isNaN(num)) return 0;
  
  // If value is > 1, assume it's 0-100 scale and convert to 0-1
  if (num > 1) {
    return Math.max(0, Math.min(1, num / 100));
  }
  
  // Otherwise, clamp to 0-1 range
  return Math.max(0, Math.min(1, num));
}

/**
 * Normalize voice settings to ElevenLabs format
 * Accepts camelCase or snake_case input, returns snake_case output
 */
export function normalizeVoiceSettings(settings = {}) {
  const normalized = {
    stability: norm01(settings.stability ?? settings.stability ?? 0.5),
    similarity_boost: norm01(settings.similarity_boost ?? settings.similarityBoost ?? 0.75),
    style: norm01(settings.style ?? 0),
    use_speaker_boost: Boolean(settings.use_speaker_boost ?? settings.useSpeakerBoost ?? true)
  };
  
  return normalized;
}

/**
 * Log normalized settings for debugging
 */
export function logNormalizedSettings(prefix, original, normalized) {
  console.log(`${prefix} Original settings:`, original);
  console.log(`${prefix} Normalized settings:`, normalized);
}
