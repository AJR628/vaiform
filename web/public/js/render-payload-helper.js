/**
 * Render Payload Helper
 * Provides functions to build the shorts/create payload with saved overlay meta
 *
 * Usage in finalize handler:
 *
 * ```javascript
 * import { buildShortsPayload, validateBeforeRender } from './js/render-payload-helper.js';
 *
 * async function finalizeShort() {
 *   const validation = validateBeforeRender();
 *   if (!validation.valid) {
 *     alert(`Cannot render: ${validation.errors.join(', ')}`);
 *     return;
 *   }
 *
 *   const payload = buildShortsPayload({
 *     text: quoteText,
 *     background: selectedBackground,
 *     voiceover: voiceoverEnabled,
 *     // ... other options
 *   });
 *
 *   const result = await apiFetch('/shorts/create', {
 *     method: 'POST',
 *     body: payload
 *   });
 * }
 * ```
 */

import { getSavedOverlayMeta, validateOverlayCaption } from './caption-preview.js';

// Re-export for creative.html import chain
export { getSavedOverlayMeta, validateOverlayCaption } from './caption-preview.js';

/**
 * Validate overlay meta before rendering
 * @returns {Object} { valid: boolean, errors: string[], meta: Object|null }
 */
export function validateBeforeRender() {
  const meta = getSavedOverlayMeta();

  if (!meta) {
    return {
      valid: false,
      errors: ['No preview saved. Please generate a preview first.'],
      meta: null,
    };
  }

  // Validate the overlay caption contract
  const validation = validateOverlayCaption(meta);

  if (!validation.valid) {
    return {
      valid: false,
      errors: validation.errors,
      meta,
    };
  }

  return {
    valid: true,
    errors: [],
    meta,
  };
}

/**
 * Build shorts/create payload with saved overlay meta
 *
 * @param {Object} options - Shorts creation options
 * @param {string} options.text - Quote text
 * @param {Object} options.background - Background configuration
 * @param {boolean} [options.voiceover] - Enable voiceover
 * @param {boolean} [options.watermark] - Enable watermark
 * @param {number} [options.durationSec] - Duration in seconds
 * @param {string} [options.voiceId] - Voice ID for TTS
 * @param {string} [options.template] - Template name
 * @param {boolean} [options.wantAttribution] - Include attribution
 * @returns {Object} Payload for /api/shorts/create
 */
export function buildShortsPayload(options) {
  const {
    text,
    background = { kind: 'solid' },
    voiceover = false,
    watermark = true,
    durationSec = 8,
    voiceId,
    template = 'calm',
    wantAttribution = true,
    modelId,
    outputFormat,
    voiceSettings,
  } = options;

  // Get saved overlay meta
  const overlayMeta = getSavedOverlayMeta();

  // Base payload
  const payload = {
    mode: 'quote',
    text,
    template,
    durationSec,
    voiceover,
    wantAttribution,
    background,
    watermark,
    captionMode: overlayMeta ? 'overlay' : 'static',
  };

  // Add overlay caption if available
  if (overlayMeta) {
    payload.overlayCaption = overlayMeta;
    console.log('[render] Using saved overlay meta for render:', {
      xPct: overlayMeta.xPct,
      yPct: overlayMeta.yPct,
      fontPx: overlayMeta.fontPx,
      text: overlayMeta.text.substring(0, 50) + '...',
    });
  }

  // Add optional fields
  if (voiceId) payload.voiceId = voiceId;
  if (modelId) payload.modelId = modelId;
  if (outputFormat) payload.outputFormat = outputFormat;
  if (voiceSettings) payload.voiceSettings = voiceSettings;

  return payload;
}

/**
 * Show UI indicator for saved preview state
 * @param {string} containerSelector - CSS selector for container
 */
export function showPreviewSavedIndicator(containerSelector = '#preview-status') {
  const container = document.querySelector(containerSelector);
  if (!container) return;

  const meta = getSavedOverlayMeta();

  if (meta) {
    container.innerHTML = `
      <div class="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded text-sm">
        <span>✓</span>
        <span>Preview saved - ready to render</span>
      </div>
    `;
    container.classList.remove('hidden');
  } else {
    container.innerHTML = `
      <div class="flex items-center gap-2 px-3 py-2 bg-yellow-600 text-white rounded text-sm">
        <span>⚠</span>
        <span>No preview saved - generate preview before rendering</span>
      </div>
    `;
    container.classList.remove('hidden');
  }
}

/**
 * Mark preview as having unsaved changes
 * Call this when user edits caption after preview
 */
export function markPreviewUnsaved() {
  // Clear saved meta (V3 storage key)
  if (typeof window !== 'undefined') {
    window._overlayMeta = null;
    try {
      localStorage.removeItem('overlayMetaV3');
    } catch (err) {
      console.warn('[render-helper] Failed to clear localStorage:', err.message);
    }
  }

  // Hide preview status and show Save Preview button
  const container = document.querySelector('#preview-status');
  if (container) {
    container.classList.add('hidden');
  }

  const saveBtn = document.querySelector('#save-preview-btn');
  if (saveBtn) {
    saveBtn.style.display = 'block';
  }

  // Update render button state (disable since no saved preview)
  if (typeof window !== 'undefined' && window.updateRenderButtonState) {
    window.updateRenderButtonState();
  }
}

// Make functions globally available
if (typeof window !== 'undefined') {
  window.validateBeforeRender = validateBeforeRender;
  window.buildShortsPayload = buildShortsPayload;
  window.showPreviewSavedIndicator = showPreviewSavedIndicator;
  window.markPreviewUnsaved = markPreviewUnsaved;
}
