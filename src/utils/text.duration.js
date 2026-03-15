/**
 * Calculate video segment duration based on text length
 * Uses natural reading speed to determine how long text should be displayed
 */

/**
 * Calculate reading duration for text
 * @param {string} text - Text to calculate duration for
 * @param {object} options - Configuration options
 * @param {number} options.wordsPerMinute - Reading speed in WPM (default: 150)
 * @param {number} options.baseTime - Base time in seconds (default: 2)
 * @param {number} options.minDuration - Minimum duration in seconds (default: 3)
 * @param {number} options.maxDuration - Maximum duration in seconds (default: 10)
 * @returns {number} Duration in seconds (rounded to nearest 0.5)
 */
export function calculateReadingDuration(text, options = {}) {
  if (!text || typeof text !== 'string') {
    return options.minDuration || 3;
  }

  const wordsPerMinute = options.wordsPerMinute || 150;
  const wordsPerSecond = wordsPerMinute / 60; // ~2.5 WPS for 150 WPM
  const baseTime = options.baseTime || 2;
  const minDuration = options.minDuration || 3;
  const maxDuration = options.maxDuration || 10;

  // Count words (split on whitespace, filter empty strings)
  const words = text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  const wordCount = words.length;

  // Calculate duration: base time + reading time
  const readingTime = wordCount / wordsPerSecond;
  const duration = baseTime + readingTime;

  // Round to nearest 0.5 seconds
  const rounded = Math.round(duration * 2) / 2;

  // Apply bounds
  return Math.max(minDuration, Math.min(maxDuration, rounded));
}

/**
 * Calculate a whole-script speech duration estimate for billing fallback.
 * This is intentionally separate from calculateReadingDuration(), which is
 * tuned for caption/display pacing and applies its floor/base per sentence.
 *
 * @param {string} text
 * @param {object} options
 * @param {number} options.wordsPerMinute
 * @param {number} options.baseTime
 * @param {number} options.minDuration
 * @param {number} options.maxDuration
 * @returns {number}
 */
export function calculateBillingSpeechDuration(text, options = {}) {
  if (!text || typeof text !== 'string') {
    return options.minDuration || 2;
  }

  const wordsPerMinute = options.wordsPerMinute || 105;
  const wordsPerSecond = wordsPerMinute / 60;
  const baseTime = options.baseTime || 2;
  const minDuration = options.minDuration || 2;
  const maxDuration = options.maxDuration || 180;

  const normalized = text
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return minDuration;
  }

  const words = normalized.split(/\s+/).filter((w) => w.length > 0);
  const readingTime = words.length / wordsPerSecond;
  const duration = baseTime + readingTime;
  const rounded = Math.round(duration * 2) / 2;

  return Math.max(minDuration, Math.min(maxDuration, rounded));
}

export default { calculateReadingDuration, calculateBillingSpeechDuration };
