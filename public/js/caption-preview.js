/**
 * Caption Preview API Integration
 * Provides functions to generate caption PNG previews using the new overlay system
 */

/**
 * Generate a caption preview PNG
 * @param {Object} options - Caption style options
 * @param {string} options.text - Caption text
 * @param {string} [options.jobId] - Optional job ID
 * @param {number} [options.fontPx=44] - Font size in pixels
 * @param {string} [options.align='center'] - Text alignment
 * @param {number} [options.xPx=42] - Caption box X position
 * @param {number} [options.yPx=230] - Caption box Y position
 * @param {number} [options.wPx=996] - Caption box width
 * @param {number} [options.hPx=400] - Caption box height
 * @returns {Promise<Object>} Caption image result
 */
export async function generateCaptionPreview(options) {
  const {
    text,
    jobId,
    fontPx = 44,
    align = 'center',
    xPx = 42,
    yPx = 230,
    wPx = 996,
    hPx = 400,
  } = options;

  if (!text?.trim()) {
    throw new Error('Caption text is required');
  }

  const style = {
    text: text.trim(),
    fontFamily: 'DejaVuSans',
    fontWeight: 700,
    fontPx,
    lineSpacingPx: Math.round(fontPx * 1.2),
    align,
    textAlpha: 1.0,
    fill: 'rgba(255,255,255,1)',
    strokePx: 3,
    strokeColor: 'rgba(0,0,0,0.85)',
    shadowX: 0,
    shadowY: 2,
    shadowBlur: 4,
    shadowColor: 'rgba(0,0,0,0.55)',
    boxXPx: xPx,
    boxYPx: yPx,
    boxWPx: wPx,
    boxHPx: hPx,
    canvasW: 1080,
    canvasH: 1920,
  };

  const payload = {
    style,
    ...(jobId && { jobId }),
  };

  try {
    // Get auth token with better error handling
    let token = null;
    const user = window.auth?.currentUser;
    
    if (user) {
      try {
        token = await user.getIdToken();
      } catch (authError) {
        console.warn('[caption-preview] Auth token failed, trying without auth:', authError.message);
      }
    } else {
      console.warn('[caption-preview] No authenticated user found, trying without auth');
    }

    const headers = {
      'Content-Type': 'application/json',
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch('/api/preview/caption', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    // Handle HTML error responses (like 404 pages)
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}. Expected JSON response.`);
    }

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.detail || result.reason || `HTTP ${response.status}: Preview generation failed`);
    }

    if (!result.ok) {
      throw new Error(result.detail || result.reason || 'Preview generation failed');
    }

    return result.data;
  } catch (error) {
    console.error('[caption-preview] Generation failed:', error);
    throw error;
  }
}

/**
 * Create a caption overlay element for preview
 * @param {Object} captionData - Caption image data from generateCaptionPreview
 * @param {HTMLElement} container - Container element for the overlay
 * @param {Object} [scaling] - Scaling options for different preview sizes
 * @param {number} [scaling.previewW=1080] - Preview container width
 * @param {number} [scaling.previewH=1920] - Preview container height
 * @returns {HTMLImageElement} The created overlay image element
 */
export function createCaptionOverlay(captionData, container, scaling = {}) {
  const { previewW = 1080, previewH = 1920 } = scaling;
  
  // Calculate scale factors
  const scaleX = previewW / 1080;
  const scaleY = previewH / 1920;
  
  // Create overlay image element
  const overlay = document.createElement('img');
  overlay.src = captionData.imageUrl;
  overlay.className = 'caption-overlay';
  overlay.style.cssText = `
    position: absolute;
    left: ${captionData.xPx * scaleX}px;
    top: ${captionData.yPx * scaleY}px;
    width: ${captionData.wPx * scaleX}px;
    height: ${captionData.hPx * scaleY}px;
    pointer-events: none;
    z-index: 10;
  `;
  
  // Remove any existing caption overlays
  const existingOverlays = container.querySelectorAll('.caption-overlay');
  existingOverlays.forEach(el => el.remove());
  
  // Add to container
  container.appendChild(overlay);
  
  return overlay;
}

/**
 * Debounced caption preview generator
 * @param {Function} callback - Function to call with generated caption data
 * @param {number} [delay=300] - Debounce delay in milliseconds
 * @returns {Function} Debounced function
 */
export function createDebouncedCaptionPreview(callback, delay = 300) {
  let timeoutId;
  
  return function(options) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(async () => {
      try {
        const result = await generateCaptionPreview(options);
        callback(null, result);
      } catch (error) {
        callback(error, null);
      }
    }, delay);
  };
}

// Make functions globally available for legacy compatibility
if (typeof window !== 'undefined') {
  window.generateCaptionPreview = generateCaptionPreview;
  window.createCaptionOverlay = createCaptionOverlay;
  window.createDebouncedCaptionPreview = createDebouncedCaptionPreview;
}
