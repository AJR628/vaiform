import { BACKEND as BACKEND_FROM_CONFIG } from '/config.js';

// Boot: restore dependencies removed in Commit 6 so legacy mode can still run if loaded
(async function bootLegacyDeps() {
  if (typeof document === 'undefined' || !document.querySelector('#stage')) return;
  try {
    const rph = await import('/js/render-payload-helper.js');
    window.getSavedOverlayMeta = rph.getSavedOverlayMeta;
    window.validateOverlayCaption = rph.validateOverlayCaption;
    window.validateBeforeRender = rph.validateBeforeRender;
    window.showPreviewSavedIndicator = rph.showPreviewSavedIndicator;
    window.markPreviewUnsaved = rph.markPreviewUnsaved;
  } catch (e) {
    console.warn('[legacy] render-payload-helper load failed', e);
    window.getSavedOverlayMeta =
      window.getSavedOverlayMeta ||
      function () {
        return null;
      };
    window.showPreviewSavedIndicator = window.showPreviewSavedIndicator || function () {};
  }
  try {
    await import('/js/caption-live.js');
  } catch (e) {
    console.warn('[legacy] caption-live load failed', e);
  }
  try {
    const co = await import('/js/caption-overlay.js');
    window.extractRenderedLines = co.extractRenderedLines;
    window.extractLinesStable = co.extractLinesStable;
  } catch (e) {
    console.warn('[legacy] caption-overlay window assign failed', e);
  }
  if (typeof window._previewSavedForCurrentText === 'undefined') {
    window._previewSavedForCurrentText = false;
  }
})();

// [STUDIO] Legacy quote/asset studio disabled for v1 - only Article Explainer is core
const ENABLE_LEGACY_STUDIO = false;

// Guard rule: Do not mix ?? with || / && without parentheses (it can throw a SyntaxError).
// Use ?? consistently or add parentheses.

const API_BASE_FALLBACK =
  'https://17e0d1d1-e327-483d-b1ea-c41bea08fb59-00-1ef93t84nlhq6.janeway.replit.dev';
// Hard-force the backend origin to Replit to avoid Netlify handling /cdn
const API_BASE_FIXED =
  'https://17e0d1d1-e327-483d-b1ea-c41bea08fb59-00-1ef93t84nlhq6.janeway.replit.dev';
function getApiBase() {
  return API_BASE_FIXED.replace(/\/$/, '');
}

// --- Simple mobile mode detection ---
function isSimpleMobile() {
  return window.innerWidth <= 768 || window.matchMedia('(pointer: coarse)').matches;
}
window.isSimpleMobile = isSimpleMobile;

// --- Helper to mark desktop-only elements as hidden ---
function markDesktopOnly(el, description) {
  if (el) {
    el.style.display = 'none';
    console.log('[simple-mobile] hiding desktop-only element:', description);
  }
}

// --- Auth ready (wait for Firebase to finish initializing exactly once) ---
window.__authReady =
  window.__authReady ||
  new Promise((resolve) => {
    try {
      // If firebase auth is already available, attach listener; otherwise poll briefly
      const attach = () => {
        if (window.firebase && window.firebase.auth) {
          window.firebase.auth().onAuthStateChanged((user) => {
            window.__currentUser = user || null;
            resolve(user || null);
          });
          return true;
        }
        return false;
      };
      if (!attach()) {
        const t = setInterval(() => {
          if (attach()) clearInterval(t);
        }, 50);
        setTimeout(() => {
          clearInterval(t);
          resolve(null);
        }, 5000); // worst-case resolve
      }
    } catch {
      resolve(null);
    }
  });

// --- Caption sizing constants (HOISTED) ---
const UI_MIN_PX = 48; // slider min visual (increased to prevent text disappearing)
const UI_MID_PX = 72; // slider mid visual (more reasonable middle)
const UI_MAX_PX = 120; // slider max visual (capped to prevent overflow)
const API_MIN_PX = 32; // backend clamp lower bound
const API_MAX_PX = 120; // backend clamp upper bound (match server ABS_MAX_FONT)

// --- Caption size mapping (define BEFORE any usage)
function mapSliderToPx(sliderVal) {
  // non-linear map slider value to pixel range, then clamp to API bounds
  const raw = Number(sliderVal);

  if (!isFinite(raw)) {
    return API_MIN_PX + (API_MAX_PX - API_MIN_PX) / 2; // fallback to middle
  }

  const v = Math.max(0, Math.min(100, raw));
  const t = v / 100;
  // Non-linear mapping: size = 32 + (120-32)*Math.pow(t,0.6)
  const size = API_MIN_PX + (API_MAX_PX - API_MIN_PX) * Math.pow(t, 0.6);

  return Math.max(API_MIN_PX, Math.min(API_MAX_PX, Math.round(size)));
}

function getCaptionPx() {
  const el = document.getElementById('caption-size');
  return mapSliderToPx(el ? el.value : 50);
}

// Font size clamping to prevent overflow with binary search for better responsiveness
function fitFontPx(targetFontPx, text, W = 1080, H = 1920) {
  const min = 24,
    max = 160;
  const padPctTop = 0.08,
    padPctBottom = 0.08;
  const maxWidthPct = 0.9; // increased from 0.85
  const lineHeight = 1.05; // reduced from 1.1
  const maxTextWidth = W * maxWidthPct;
  const maxTextHeight = H * (1 - padPctTop - padPctBottom);

  function measureFits(fontPx) {
    // Simple word wrapping simulation
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      // Rough width estimation (fontPx * 0.6 is approximate)
      const estimatedWidth = testLine.length * fontPx * 0.6;

      if (estimatedWidth <= maxTextWidth && currentLine) {
        currentLine = testLine;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);

    const totalHeight = lines.length * fontPx * lineHeight;
    return totalHeight <= maxTextHeight;
  }

  let lo = min,
    hi = Math.min(max, targetFontPx),
    best = lo;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1; // binary search
    if (measureFits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (best !== targetFontPx) {
    console.log(
      `[caption] Font size ${targetFontPx}px fitted to ${best}px for better responsiveness`
    );
  }

  return best;
}

// Fix D: Preview geometry helper using proper CSS/backing separation
function getPreviewGeometry(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth; // CSS size
  const cssH = canvas.clientHeight; // CSS size
  const backingW = canvas.width; // Backing store size
  const backingH = canvas.height; // Backing store size
  const scaleX = cssW / 1080; // CSS size to PNG native size
  const scaleY = cssH / 1920;

  return { dpr, cssW, cssH, backingW, backingH, scaleX, scaleY };
}

// expose for other code
window.getCaptionPx = getCaptionPx;
window.__captionSizeMapping = {
  mapSliderToPx,
  API_MIN_PX,
  API_MAX_PX,
  UI_MIN_PX,
  UI_MID_PX,
  UI_MAX_PX,
};

// --- Auth-aware login warning function ---
async function ensureLoggedInOrWarn() {
  const warnEl = document.getElementById('asset-error'); // the red text element
  if (!warnEl) return true; // nothing to do
  const user = await window.__authReady;
  const isLoggedIn = !!user;
  if (isLoggedIn) {
    warnEl.style.display = 'none'; // hide when logged in
  }
  return isLoggedIn;
}

// --- Helper to get active asset type ---
function getActiveAssetType() {
  const activeTab =
    document.querySelector('[data-type].bg-blue-600') || document.querySelector('[data-type]');
  return activeTab?.dataset.type || 'images'; // fallback to images (default tab)
}

// --- High-quality Pexels preview URL helper ---
function bestPexelsPreviewUrl(photo, targetWidth = 720, targetHeight = 1280) {
  if (!photo || !photo.src) return null;

  const src = photo.src;
  const dpr = Math.min(window.devicePixelRatio || 1, 2); // Cap at 2x for performance

  // Prefer portrait, then large2x, then large, fallback to original/medium
  let baseUrl = src.portrait || src.large2x || src.large || src.original || src.medium;

  if (!baseUrl) return null;

  // Add Pexels optimization parameters for high-quality preview
  const params = new URLSearchParams({
    auto: 'compress',
    cs: 'tinysrgb',
    dpr: dpr.toString(),
    fit: 'crop',
    w: targetWidth.toString(),
    h: targetHeight.toString(),
  });

  return `${baseUrl}?${params.toString()}`;
}

// === Pexels Preview Quality + Trace Helpers ===
function _isHiResPreviewUrl(url) {
  if (!url) return false;
  // Must NOT be just h=350; should include fit=crop and explicit w/h and dpr
  return /fit=crop/.test(url) && /[?&]w=\d+/.test(url) && /[?&]h=\d+/.test(url);
}

function _pexelsPreviewUrlFromPhoto(photo, needW, needH, headroom = 1.2) {
  const base =
    photo?.src?.portrait ||
    photo?.src?.large2x ||
    photo?.src?.large ||
    photo?.src?.original ||
    photo?.src?.medium;
  if (!base) return null;
  const join = base.includes('?') ? '&' : '?';
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const w = Math.ceil(needW * headroom);
  const h = Math.ceil(needH * headroom);
  return `${base}${join}auto=compress&cs=tinysrgb&fit=crop&dpr=${dpr}&w=${w}&h=${h}`;
}

// Fix B: Updated HiDPI canvas setup using sizeCanvasToCSS
function _setupHiDPICanvas(canvas, cssW, cssH) {
  // Use the new sizing function
  if (!sizeCanvasToCSS(canvas)) {
    // Fallback to manual setup if sizeCanvasToCSS fails
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
  }

  const ctx = canvas.getContext('2d');
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { ctx, dpr };
}

// Visual breadcrumb on the canvas so we know who drew last
const DEBUG_CANVAS = false;
function _tapCanvas(label) {
  if (!DEBUG_CANVAS) return;
  try {
    const c = document.getElementById('live-preview-canvas');
    if (!c) return;
    const x = c.getContext('2d');
    x.save();
    x.font = '12px system-ui';
    x.fillStyle = 'rgba(255,255,255,.95)';
    x.strokeStyle = 'rgba(0,0,0,.6)';
    x.strokeText(label, 8, 18);
    x.fillText(label, 8, 18);
    x.restore();
  } catch {}
}

// Legacy function - now calls the new helper
function pexelsPreviewUrl(photo, needW, needH, headroom = 1.2) {
  return _pexelsPreviewUrlFromPhoto(photo, needW, needH, headroom);
}

// --- Pexels hi-res intercept helpers (preview-only) ---
function _buildHiResPexelsUrlFromBase(baseUrl, needW, needH) {
  try {
    const u = new URL(baseUrl);
    if (u.hostname !== 'images.pexels.com') return baseUrl;
    // We always prefer fit=crop + explicit w/h + dpr
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    u.searchParams.set('auto', 'compress');
    u.searchParams.set('cs', 'tinysrgb');
    u.searchParams.set('fit', 'crop');
    u.searchParams.set('dpr', String(dpr));
    u.searchParams.set('w', String(Math.ceil(needW * 1.2)));
    u.searchParams.set('h', String(Math.ceil(needH * 1.2)));
    // remove stray h=350 if present
    return u.toString();
  } catch {
    return baseUrl;
  }
}

// Given whatever the app thinks is the preview URL, ensure it is hi-res for the canvas draw.
function _ensureHiResPreviewUrl(rawUrl, canvas) {
  if (!rawUrl) return rawUrl;
  const needW = canvas.width || canvas.clientWidth;
  const needH = canvas.height || canvas.clientHeight;
  return _buildHiResPexelsUrlFromBase(rawUrl, needW, needH);
}

// Fix A: Use predictable wrapper dimensions
function layoutPreviewDims() {
  const box = document.querySelector('#live-preview-container .relative');
  if (box) {
    // Use the fixed wrapper dimensions
    const cssW = box.clientWidth || 360; // fallback to our fixed width
    const cssH = Math.round((cssW * 16) / 9); // lock to 9:16 portrait
    return { cssW, cssH };
  }
  // Fallback to default dimensions
  return { cssW: 360, cssH: 640 };
}

function drawCover(ctx, img, cssW, cssH) {
  const iw = img.naturalWidth,
    ih = img.naturalHeight;
  const scale = Math.max(cssW / iw, cssH / ih); // COVER (fill + crop)
  const dw = iw * scale,
    dh = ih * scale;
  const dx = (cssW - dw) / 2,
    dy = (cssH - dh) / 2;
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.drawImage(img, dx, dy, dw, dh);
}

function setupHiDPICanvas(canvas, cssW, cssH) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { ctx, dpr };
}

// --- High-quality canvas drawing helper with HiDPI support ---
function drawPreviewOnCanvas(canvas, ctx, img, targetWidth = 400, targetHeight = 711) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2); // Cap at 2x for performance

  // Set up HiDPI canvas
  canvas.width = targetWidth * dpr;
  canvas.height = targetHeight * dpr;
  canvas.style.width = `${targetWidth}px`;
  canvas.style.height = `${targetHeight}px`;

  // Enable high-quality image smoothing
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Set transform for HiDPI
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Calculate cover-fit dimensions (fill canvas without distortion)
  const imgAspect = img.naturalWidth / img.naturalHeight;
  const canvasAspect = targetWidth / targetHeight;

  let drawWidth, drawHeight, drawX, drawY;

  if (imgAspect > canvasAspect) {
    // Image is wider - fit height, crop width
    drawHeight = targetHeight;
    drawWidth = drawHeight * imgAspect;
    drawX = (targetWidth - drawWidth) / 2;
    drawY = 0;
  } else {
    // Image is taller - fit width, crop height
    drawWidth = targetWidth;
    drawHeight = drawWidth / imgAspect;
    drawX = 0;
    drawY = (targetHeight - drawHeight) / 2;
  }

  // Draw the image with cover-fit
  ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
}

// --- Race protection for preview loading ---
let _previewReqId = 0;
let _currentPexelsPhoto = null; // Track current photo for resize re-rendering

async function _drawBackground(url, canvas, cssW, cssH, who = 'drawBackground') {
  const my = ++_previewReqId;
  const startTime = performance.now();
  console.log('[asset-load] Starting background load:', { url: url.substring(0, 50), who, my });

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  if (my !== _previewReqId) return;

  const loadTime = performance.now() - startTime;
  console.log('[asset-load] Background loaded:', {
    duration: Math.round(loadTime),
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    who,
    my,
  });

  const ctx = canvas.getContext('2d');
  const iw = img.naturalWidth,
    ih = img.naturalHeight;
  const scale = Math.max(cssW / iw, cssH / ih);
  const dw = iw * scale,
    dh = ih * scale;
  const dx = (cssW - dw) / 2,
    dy = (cssH - dh) / 2;
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.drawImage(img, dx, dy, dw, dh);

  console.log('[asset-load] First drawImage completed:', {
    duration: Math.round(performance.now() - startTime),
    canvasSize: `${cssW}x${cssH}`,
    imageSize: `${iw}x${ih}`,
    drawSize: `${dw}x${dh}`,
    who,
    my,
  });
  window._currentPreviewUrl = url;
  _tapCanvas(`${who}`);
}

// --- Debounced caption overlay refresh (prevents blocking assets) ---
let overlayRefreshTimer = null;
function queueCaptionOverlayRefresh() {
  // Legacy function - no longer used in overlay mode
  if (overlayRefreshTimer) clearTimeout(overlayRefreshTimer);
  overlayRefreshTimer = setTimeout(() => {
    try {
      // Call existing caption overlay update function
      if (typeof updateCaptionOverlay === 'function' && currentQuote?.text) {
        updateCaptionOverlay(currentQuote.text.trim(), true);
      }
    } catch (e) {
      console.warn('[caption-overlay] preview failed (non-fatal)', e);
    }
  }, 120); // 120ms debounce to reduce server load
}

// Safe placeholder if real loader is attached later
window.loadVoices =
  window.loadVoices ||
  async function () {
    console.debug('[voice] loadVoices placeholder (no-op)');
    // If you have a real loader like populateVoicesDropdown(), call it here instead:
    // return populateVoicesDropdown();
  };

// Helper for clearer logging
window.__log = (...args) => console.log('[assets]', ...args);

// Global state
let currentLimits = null;
let currentQuote = null;
let selectedAsset = null;
let currentStorySessionId = null;
let currentStoryUrl = null;
// SSOT: Use window scope so ui-actions.js can update it
window.currentAssetType = window.currentAssetType || 'images';

// Draft storyboard state (client-only, no API calls)
// Phase 1: Start with 1 empty beat instead of 8
window.draftStoryboard = window.draftStoryboard || {
  beats: [{ id: generateBeatId(), text: '', selectedClip: null }],
};

// Mode switching SSOT function
window.setStudioMode = function (mode) {
  // [STUDIO] Block switching to quotes mode if legacy studio is disabled
  if (!ENABLE_LEGACY_STUDIO && mode === 'quotes') {
    console.warn('[studio] Legacy quotes mode disabled - staying in articles mode');
    mode = 'articles';
  }

  document.querySelectorAll('[data-mode]').forEach((el) => {
    el.style.display = el.dataset.mode === mode ? '' : 'none';
  });
  window.currentStudioMode = mode; // optional, handy for debugging

  // Update tab styles
  const quotesTab = document.getElementById('mode-quotes-tab');
  const articlesTab = document.getElementById('mode-articles-tab');
  if (quotesTab) {
    if (mode === 'quotes') {
      quotesTab.classList.remove('bg-gray-600', 'dark:bg-gray-700');
      quotesTab.classList.add('bg-blue-600');
      if (articlesTab) {
        articlesTab.classList.remove('bg-blue-600');
        articlesTab.classList.add('bg-gray-600', 'dark:bg-gray-700');
      }
    } else {
      if (articlesTab) {
        articlesTab.classList.remove('bg-gray-600', 'dark:bg-gray-700');
        articlesTab.classList.add('bg-blue-600');
      }
      quotesTab.classList.remove('bg-blue-600');
      quotesTab.classList.add('bg-gray-600', 'dark:bg-gray-700');
    }
  }
};
let currentAssetPage = 1;
let hasMoreAssets = false;
let currentCredits = 0;
let remixAssets = [];
let assetCache = new Map(); // Cache for pagination
let uploadedAssets = [];
let availableVoices = [];
let currentVoiceId = null;

// Helper functions - PNG overlay system
let captionOverlayState = null;
let captionDebounceTimer = null;

// New draggable overlay system
let overlaySystemInitialized = false;
let useOverlayMode = true; // Default to overlay mode as SSOT (V3 raster)

// ✅ Clear legacy V2 cache to prevent schema mixing
try {
  const v2Keys = ['overlayMetaV2', 'overlayMeta', 'lastCaptionOverlay'];
  v2Keys.forEach((key) => {
    const stored = localStorage.getItem(key);
    if (stored) {
      const meta = JSON.parse(stored);
      if (meta.ssotVersion !== 3) {
        console.log('[v3:cleanup] Removing legacy V2 cache:', key);
        localStorage.removeItem(key);
      }
    }
  });
} catch (e) {
  console.warn('[v3:cleanup] Cache cleanup failed:', e);
}

// Helper functions for overlay management
const must = (sel) => {
  const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
  if (!el) throw new Error('MISSING_EL: ' + sel);
  return el;
};

const canOverlay = () => useOverlayMode && overlaySystemInitialized;

function setQuoteUI(text) {
  const out = document.querySelector('#quote-result');
  if (out) out.textContent = text;
}

async function maybeUpdateOverlay(text, force = true) {
  try {
    await ensureOverlayActive();
    if (canOverlay()) {
      await updateOverlayCaption(text.trim(), force);
    } else {
      setQuoteUI(text);
    }
  } catch (e) {
    console.warn('[overlay] fallback to text-only UI', e);
    setQuoteUI(text);
  }
}

// Ensure overlay is active and initialized
async function ensureOverlayActive() {
  try {
    useOverlayMode = true;
    const chk = document.getElementById('overlay-mode-toggle');
    if (chk && !chk.checked) chk.checked = true;
    if (!overlaySystemInitialized) {
      await initOverlaySystem();
    }
    // Apply current quote text into overlay and refresh background
    if (currentQuote?.text) {
      try {
        const { setQuote } = await import('/js/caption-overlay.js');
        setQuote(currentQuote.text.trim());
        console.log('[overlay-caption] set:', currentQuote.text.trim().substring(0, 80));
      } catch {}
    }
    if (typeof updateOverlayCanvasBackground === 'function') updateOverlayCanvasBackground();
    // Reflect UI: show stage, hide legacy image
    const stage = document.getElementById('stage');
    const legacyOverlay = document.getElementById('caption-overlay');
    if (stage) {
      stage.style.display = 'block';
      // Ensure stage has minimum height and black background when no media
      if (!selectedAsset) {
        stage.style.minHeight = '400px';
        stage.style.backgroundColor = '#000';
        const previewMedia = document.getElementById('previewMedia');
        if (previewMedia) {
          previewMedia.src =
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
          previewMedia.style.display = 'block';
        }
      }
    }
    if (legacyOverlay) legacyOverlay.style.display = 'none';

    // Unhide container if there's a quote
    if (currentQuote?.text) {
      const container = document.getElementById('live-preview-container');
      if (container) {
        container.classList.remove('opacity-0');
        // Only set inline opacity if style is currently empty (to not override transitions)
        if (!container.style.opacity) {
          container.style.opacity = '1';
        }
        // Force layout recalculation on mobile
        void container.offsetHeight;
      }
    }

    console.log('[overlay] ensureOverlayActive: stage visible, hasMedia:', !!selectedAsset);
  } catch (e) {
    console.warn('[overlay] ensureOverlayActive failed', e);
  }
}

// Debounced caption preview generator
function debouncedPreview(delay = 200) {
  // Legacy function - no longer used in overlay mode
  clearTimeout(captionDebounceTimer);
  captionDebounceTimer = setTimeout(() => {
    if (currentQuote?.text?.trim()) {
      updateCaptionOverlay(currentQuote.text.trim(), true);
    }
  }, delay);
}

function maybeGenerateCaptionPreview() {
  const txt = currentQuote?.text?.trim() || '';
  if (txt.length && selectedAsset) {
    debouncedPreview();
  }
}

async function updateCaptionOverlay(text = '', show = true) {
  // Legacy function - use maybeUpdateOverlay instead for new overlay system
  console.log('[preview-init] updateCaptionOverlay called with:', {
    text: text?.substring(0, 50),
    show,
  });

  // Unhide container when showing a quote
  if (show === true) {
    const container = document.getElementById('live-preview-container');
    if (container) {
      container.classList.remove('opacity-0');
      // Only set inline opacity if style is currently empty (to not override transitions)
      if (!container.style.opacity) {
        container.style.opacity = '1';
      }
      // Force layout recalculation on mobile
      void container.offsetHeight;
    }
  }

  const overlay = document.getElementById('caption-overlay');
  if (!overlay) return;

  // Ensure container is visible and has a size before drawing
  const container = document.getElementById('live-preview-container');
  if (!container) return;

  // Fallback gate: Don't proceed if container is effectively hidden (but allow opacity-0 if has dimensions)
  if (container.offsetParent === null) {
    console.log('[preview-init] Container not visible, skipping caption overlay');
    return;
  }

  // If container has opacity-0 but has dimensions, proceed (will be made visible)
  if (container.classList.contains('opacity-0')) {
    console.log('[preview-init] Container has opacity-0 but has dimensions, proceeding...');
  }

  container.classList.remove('opacity-0');

  // Log container dimensions
  const containerRect = container.getBoundingClientRect();
  console.log('[preview-init] container dimensions:', {
    cssW: containerRect.width,
    cssH: containerRect.height,
    dpr: window.devicePixelRatio,
  });

  // New canvas ready logic with feature flag
  if (window.__PREVIEW_FIX__) {
    const canvas = document.getElementById('live-preview-canvas');
    if (!canvas || !canvasReadyState.ready) {
      console.log('[canvas-ready] Canvas not ready, scheduling render');
      scheduleRender();
      return;
    }
  } else {
    // Legacy logic for fallback
    const ensureSized = () =>
      container.clientWidth > 0 && container.clientHeight > 0 ? true : false;
    if (!ensureSized()) {
      await new Promise(requestAnimationFrame);
    }
    if (!ensureSized()) {
      console.warn('[caption-overlay] Container still has no size, skipping overlay');
      return;
    }

    const canvas = document.getElementById('live-preview-canvas');
    if (!canvas || canvas.clientWidth === 0 || canvas.clientHeight === 0) {
      console.log('[canvas-ready] Canvas not ready, scheduling retry...', {
        canvasExists: !!canvas,
        clientWidth: canvas?.clientWidth,
        clientHeight: canvas?.clientHeight,
        canvasWidth: canvas?.width,
        canvasHeight: canvas?.height,
      });
      // Two RAF deferral as suggested
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const retryCanvas = document.getElementById('live-preview-canvas');
      if (!retryCanvas || retryCanvas.clientWidth === 0 || retryCanvas.clientHeight === 0) {
        console.warn('[canvas-ready] Canvas still not ready after deferral, skipping overlay');
        return;
      }
    }
  }

  // Clear existing overlay
  overlay.innerHTML = '';

  if (!show || !text?.trim()) {
    captionOverlayState = null;
    return;
  }

  // Get caption style parameters from UI
  const sizePx = 54; // Default - will be overridden by server SSOT
  const opacityPct = parseInt(document.getElementById('caption-opacity')?.value || '85', 10);
  const placement = (document.getElementById('caption-placement')?.value || 'bottom').toLowerCase();
  const showBoxToggle = document.getElementById('caption-background')?.checked || false;
  const boxOpacityPct = parseInt(document.getElementById('caption-bg-opacity')?.value || '50', 10);
  const selectedWeight = document.getElementById('caption-weight')?.value || 'bold';

  console.log('[preview-scaling]', {
    mappedSizePx: sizePx,
  });

  // Map UI selection to server placement format
  function placementToServerFormat(placement) {
    switch ((placement || 'bottom').toLowerCase()) {
      case 'top':
        return { placement: 'top' };
      case 'middle':
      case 'center':
        return { placement: 'center' };
      case 'bottom':
      default:
        return { placement: 'bottom' };
    }
  }

  // Validate yPct to prevent extreme values
  function validateYPct(yPct) {
    const clamped = Math.max(0.05, Math.min(0.95, Number(yPct)));
    if (clamped !== Number(yPct)) {
      console.warn(
        `[caption] yPct ${yPct} clamped to ${clamped} to prevent off-screen positioning`
      );
    }
    return clamped;
  }

  const placementData = placementToServerFormat(placement);

  console.log('[caption-debug] Placement mapping:', {
    uiPlacement: placement,
    serverPlacement: placementData.placement,
  });

  // Map UI font selection to server font names (only use registered fonts)
  const fontMapping = {
    system: { family: 'DejaVu Sans', weightCss: 'normal' },
    bold: { family: 'DejaVu Sans', weightCss: 'bold' },
    cinematic: { family: 'DejaVu Sans', weightCss: 'bold' }, // Fallback to DejaVu until we add more fonts
    minimal: { family: 'DejaVu Sans', weightCss: 'normal' },
  };

  const selectedFont = document.getElementById('caption-font')?.value || 'system';
  const fontConfig = fontMapping[selectedFont] || fontMapping['system'];

  const captionStyle = {
    text: text.trim(),
    fontFamily: fontConfig.family,
    weightCss: fontConfig.weightCss,
    fontPx: sizePx, // Use fitted size
    color: '#FFFFFF',
    opacity: opacityPct / 100,
    shadow: true,
    showBox: showBoxToggle,
    boxColor: `rgba(0,0,0,${boxOpacityPct / 100})`,
    placement: placementData.placement,
    yPct:
      placementData.placement === 'bottom' ? 0.9 : placementData.placement === 'top' ? 0.1 : 0.5, // Set yPct based on placement
    lineHeight: 1.05, // reduced for better stacking
    padding: 24,
    maxWidthPct: 0.9, // increased for bigger text
    borderRadius: 16,
  };

  console.log('[caption-debug] Final captionStyle:', {
    placement: captionStyle.placement,
    yPct: captionStyle.yPct,
    text: captionStyle.text.substring(0, 50) + '...',
  });

  // Debounce caption generation
  clearTimeout(captionDebounceTimer);
  captionDebounceTimer = setTimeout(async () => {
    try {
      // If draggable overlay mode is on, apply styles to overlay and skip legacy PNG path
      if (useOverlayMode) {
        try {
          const { getCaptionMeta, applyCaptionMeta } = await import('/js/caption-overlay.js');

          // Check if overlay is initialized before using getCaptionMeta
          if (typeof window.getCaptionMeta !== 'function') {
            console.warn('[overlay-style] Overlay not initialized yet, skipping style update');
            return; // Skip style update, will retry after initialization
          }

          const meta = getCaptionMeta && getCaptionMeta();
          if (meta) {
            // Update overlay style based on current UI controls
            meta.fontPx = captionStyle.fontPx;
            meta.fontFamily = captionStyle.fontFamily;
            meta.weightCss = captionStyle.weightCss || captionStyle.weight;
            meta.color = '#FFFFFF';
            meta.opacity = captionStyle.opacity;

            if (applyCaptionMeta) {
              applyCaptionMeta(meta);
            } else {
              console.warn('[overlay-style] applyCaptionMeta not available');
            }
          } else {
            console.warn(
              '[overlay-style] getCaptionMeta returned null, overlay may not be initialized'
            );
          }
          // Keep the stage background in sync with the canvas
          if (typeof updateOverlayCanvasBackground === 'function') updateOverlayCanvasBackground();
        } catch (e) {
          console.warn('[overlay-style] apply failed; falling back to legacy preview', e);
        }
        return; // Do not generate PNG while overlay mode is active
      }

      console.log('[caption-overlay] Generating PNG preview...');

      // Ensure preview container is visible before generating overlay
      document.getElementById('live-preview-container')?.classList.remove('opacity-0');

      // Import the caption preview function
      const { generateCaptionPreview, getLastCaptionPNG, createCaptionOverlay } = await import(
        '/js/caption-preview.js'
      );

      // Import the new draggable overlay system
      const { initCaptionOverlay, getCaptionMeta, applyCaptionMeta, setQuote } = await import(
        '/js/caption-overlay.js'
      );

      // Build proper payload with all controls wired
      const payload = buildCaptionPayload(text, captionStyle);

      // Generate caption PNG with new payload
      await generateCaptionPreview(payload);
      const result = getLastCaptionPNG();
      captionOverlayState = result;

      console.log('[apply-font] Caption style applied:', {
        fontFamily: payload.fontFamily,
        weight: payload.weight,
        fontPx: payload.fontPx,
        opacity: payload.opacity,
        placement: payload.placement,
      });

      console.log('[caption-overlay] meta:', {
        fontPx: result?.meta?.fontPx,
        lineSpacing: result?.meta?.lineSpacing,
        yPct: result?.meta?.yPct,
        placement: result?.meta?.placement,
        fontFamilyUsed: result?.meta?.fontFamilyUsed,
        wPx: result?.meta?.wPx,
        hPx: result?.meta?.hPx,
      });

      console.log('[caption-overlay] PNG preview generated:', result);

      // Calculate preview scaling using geometry helper
      const previewContainer = document.getElementById('live-preview-container');
      const previewCanvas = document.getElementById('live-preview-canvas');
      const geometry = getPreviewGeometry(previewCanvas);

      // Debug logging for scaling
      console.debug('[preview-scaling]', {
        cssW: geometry.cssW,
        cssH: geometry.cssH,
        backingW: geometry.backingW,
        backingH: geometry.backingH,
        dpr: geometry.dpr,
        scaleX: geometry.scaleX,
        scaleY: geometry.scaleY,
        ovW: result.meta?.wPx || 1080,
        ovH: result.meta?.hPx || 1920,
        placement: captionStyle.placement,
        yPct: result.meta?.yPct,
        fontPx: result.meta?.fontPx,
      });

      // If overlay mode is inactive, render legacy PNG overlay image
      try {
        if (!useOverlayMode) {
          createCaptionOverlay(result, overlay, {
            previewW: geometry.cssW,
            previewH: geometry.cssH,
            placement: captionStyle.placement,
          });
        }
      } catch {}

      // Debug logging
      console.log('[preview-scaling]', {
        previewW: geometry.cssW,
        previewH: geometry.cssH,
      });

      console.log('[caption-overlay] PNG overlay created successfully');

      // Log font fallback info if available
      if (result.meta?.fontFamilyUsed) {
        console.log('[caption-overlay] Font used:', result.meta.fontFamilyUsed);
      }
    } catch (error) {
      console.error('[caption-overlay] Failed to generate PNG:', error);
      console.error('[caption-overlay] Error details:', error.message);

      // TASK 7: Disable HTML fallback to prevent mega-sized text issues
      // The fallback was causing the "yo" situation mentioned in the task
      console.log('[caption-overlay] PNG generation failed, not using HTML fallback');
      overlay.innerHTML = ''; // Clear overlay instead of showing fallback text
    }
  }, 300); // 300ms debounce
}

// New draggable overlay system functions
async function initOverlaySystem() {
  if (overlaySystemInitialized) return;

  try {
    const {
      initCaptionOverlay,
      getCaptionMeta,
      applyCaptionMeta,
      setQuote,
      ensureOverlayTopAndVisible,
      bindCaptionDrag,
    } = await import('/js/caption-overlay.js');

    // Ensure stage is visible before initializing overlay
    const stage = document.querySelector('#stage');
    if (stage) {
      stage.style.display = 'block';
      stage.style.minHeight = '400px';
      stage.style.backgroundColor = '#000';
    }

    // Initialize the overlay system
    initCaptionOverlay({ stageSel: '#stage', mediaSel: '#previewMedia' });

    // Set default caption box geometry if not already set
    if (!window.__overlayMeta || !window.__overlayMeta.wPct) {
      const stage = document.querySelector('#stage');
      const w = stage?.clientWidth || 360;
      const h = stage?.clientHeight || 640;

      // Default box ~88% width, readable font, near top (SSOT: decimal fractions 0-1)
      const defaultMeta = {
        text: (currentQuote?.text || '').trim(),
        xPct: 0.04, // 4% left margin (decimal)
        yPct: 0.1, // 10% from top (decimal)
        wPct: 0.88, // 88% of stage width (decimal)
        fontFamily: 'Inter, system-ui, sans-serif',
        weightCss: '700',
        fontPx: Math.max(28, Math.min(96, Math.round(h * 0.08))),
        color: '#FFFFFF',
        opacity: 1,
        textAlign: 'center',
        paddingPx: 12,
      };

      try {
        applyCaptionMeta(defaultMeta);
        window.__overlayMeta = { ...defaultMeta, ...getCaptionMeta() };
        console.log('[overlay-default] applied:', {
          wPct: defaultMeta.wPct,
          xPct: defaultMeta.xPct,
          yPct: defaultMeta.yPct,
          fontPx: defaultMeta.fontPx,
        });
      } catch (e) {
        console.warn('[overlay-system] Failed to apply default meta:', e);
      }
    }

    try {
      ensureOverlayTopAndVisible('#stage');
    } catch {}

    // Set up the preview media source - wait for canvas to be ready
    const setupCanvasBackground = () => {
      const previewMedia = document.getElementById('previewMedia');
      const canvas = document.getElementById('live-preview-canvas');

      if (previewMedia && canvas && canvas.width > 0 && canvas.height > 0) {
        // Convert canvas to image for the overlay system
        const dataUrl = canvas.toDataURL('image/png');
        previewMedia.src = dataUrl;
        console.log('[overlay-system] Canvas background set');
        return true;
      }
      return false;
    };

    // Try to set canvas background immediately
    if (!setupCanvasBackground()) {
      // If canvas not ready, wait for it
      const checkCanvas = () => {
        if (setupCanvasBackground()) {
          console.log('[overlay-system] Canvas background set after wait');
          try {
            ensureOverlayTopAndVisible('#stage');
          } catch {}
        } else {
          // Retry in 100ms
          setTimeout(checkCanvas, 100);
        }
      };
      checkCanvas();
    }

    // Set initial quote if available
    if (currentQuote?.text) {
      setQuote(currentQuote.text);
      try {
        ensureOverlayTopAndVisible('#stage');
      } catch {}

      // Unhide container when initial quote exists
      const container = document.getElementById('live-preview-container');
      if (container) {
        container.classList.remove('opacity-0');
        // Only set inline opacity if style is currently empty (to not override transitions)
        if (!container.style.opacity) {
          container.style.opacity = '1';
        }
        // Force layout recalculation on mobile
        void container.offsetHeight;
      }
    }

    // Initialize hybrid caption preview system
    try {
      const { initHybridCaptionPreview } = await import('/js/caption-live.js');
      await initHybridCaptionPreview();
      console.log('[overlay-system] Hybrid caption preview initialized');
    } catch (error) {
      console.warn('[overlay-system] Failed to initialize hybrid caption preview:', error);
    }

    overlaySystemInitialized = true;
    console.log('[overlay-system] Initialized draggable overlay');

    // Ensure stage is not display:none after initialization
    const stageEl = document.getElementById('stage');
    if (stageEl && getComputedStyle(stageEl).display === 'none') {
      stageEl.style.display = 'block';
    }

    // Mark preview as unsaved when caption text changes (SSOT workflow)
    try {
      const captionContent = document.querySelector('.caption-box .content');
      if (captionContent) {
        // Debounce the reset to avoid triggering on every keystroke
        let resetDebounceTimer = null;
        captionContent.addEventListener('input', () => {
          clearTimeout(resetDebounceTimer);
          resetDebounceTimer = setTimeout(() => {
            // Only reset if preview was previously saved
            if (window._previewSavedForCurrentText) {
              resetPreviewSavedState();
            }
          }, 500); // Wait 500ms after user stops typing
        });
        console.log('[overlay-system] Added caption change listener for preview state');
      }

      // Also listen to quote edit textarea for unsaved changes
      const quoteEdit = document.getElementById('quote-edit');
      if (quoteEdit) {
        let resetDebounceTimer2 = null;
        quoteEdit.addEventListener('input', () => {
          clearTimeout(resetDebounceTimer2);
          resetDebounceTimer2 = setTimeout(() => {
            // Only reset if preview was previously saved
            if (window._previewSavedForCurrentText) {
              resetPreviewSavedState();
            }
          }, 500);
        });
        console.log('[overlay-system] Added quote edit change listener for preview state');
      }
    } catch (e) {
      console.warn('[overlay-system] Failed to add change listeners:', e);
    }
  } catch (error) {
    console.error('[overlay-system] Failed to initialize:', error);
  }
}

async function toggleOverlayMode() {
  const toggle = document.getElementById('overlay-mode-toggle');
  const stage = document.getElementById('stage');
  const legacyOverlay = document.getElementById('caption-overlay');
  const overlayControls = document.getElementById('overlay-controls');

  useOverlayMode = toggle.checked;

  if (useOverlayMode) {
    // Show new overlay system
    stage.style.display = 'block';
    legacyOverlay.style.display = 'none';
    try {
      overlayControls.style.display = 'block';
    } catch {}

    // Initialize overlay system if not already done
    if (!overlaySystemInitialized) {
      await initOverlaySystem();
    }

    // Wait a moment for the overlay to be ready
    setTimeout(async () => {
      // Update overlay with current quote if available
      if (currentQuote?.text) {
        await updateOverlayCaption(currentQuote.text.trim(), true);
      }
    }, 100);
  } else {
    // Show legacy overlay system
    stage.style.display = 'none';
    legacyOverlay.style.display = 'block';
    try {
      overlayControls.style.display = 'none';
    } catch {}
  }

  console.log(
    '[overlay-mode] Switched to:',
    useOverlayMode ? 'draggable overlay' : 'legacy overlay'
  );
}

// New overlay-based caption update function
async function updateOverlayCaption(text = '', show = true) {
  // Unhide container at the top (before early return)
  const container = document.getElementById('live-preview-container');
  if (container) {
    container.classList.remove('opacity-0');
    if (!container.style.opacity) {
      container.style.opacity = '1';
    }
  }

  if (!useOverlayMode || !overlaySystemInitialized) return;

  // Ensure stage is visible
  const stage = document.getElementById('stage');
  if (stage) {
    stage.style.display = 'block';
  }

  try {
    const { setQuote, getCaptionMeta, applyCaptionMeta, ensureOverlayTopAndVisible } = await import(
      '/js/caption-overlay.js'
    );

    if (show && text?.trim()) {
      setQuote(text);
    }

    // Update canvas background if needed
    updateOverlayCanvasBackground();

    console.log('[overlay-caption] Updated overlay with text:', text?.substring(0, 50));
    try {
      ensureOverlayTopAndVisible('#stage');
    } catch {}
  } catch (error) {
    console.error('[overlay-caption] Failed to update overlay:', error);
  }
}

// Update overlay canvas background
async function updateOverlayCanvasBackground() {
  if (!useOverlayMode || !overlaySystemInitialized) return;

  try {
    const previewMedia = document.getElementById('previewMedia');
    const canvas = document.getElementById('live-preview-canvas');

    if (previewMedia && canvas && canvas.width > 0 && canvas.height > 0) {
      const dataUrl = canvas.toDataURL('image/png');
      previewMedia.src = dataUrl;
      console.log('[overlay-canvas] Background updated');
      try {
        const { ensureOverlayTopAndVisible } = await import('/js/caption-overlay.js');
        ensureOverlayTopAndVisible('#stage');
      } catch {}
    }
  } catch (error) {
    console.warn('[overlay-canvas] Failed to update background:', error);
  }
}

// Convert overlay meta to SSOT payload
function overlayMetaToSSOT(meta) {
  // ✅ Extract pixels computed by emitCaptionState
  return {
    ssotVersion: 3,
    mode: 'raster',
    text: meta.text || meta.textRaw || '',
    textRaw: meta.textRaw,

    // ✅ CANONICAL PIXELS (no percentages!)
    frameW: 1080,
    frameH: 1920,
    fontPx: meta.fontPx,
    lineSpacingPx: meta.lineSpacingPx,
    letterSpacingPx: meta.letterSpacingPx,
    rasterW: meta.rasterW,
    rasterH: meta.rasterH, // ✅ Client canonical value
    yPx_png: meta.yPx_png,
    rasterPadding: meta.rasterPadding || 24, // ✅ Use consistent naming
    xExpr_png: meta.xExpr_png || '(W-overlay_w)/2',

    // lines array is already included in browserGeometry above

    // Styles
    fontFamily: meta.fontFamily || 'DejaVu Sans',
    weightCss: meta.weightCss || '700',
    fontStyle: meta.fontStyle || 'normal',
    textAlign: meta.textAlign || 'center',
    textTransform: meta.textTransform || 'none',
    color: meta.color || 'rgb(255,255,255)',
    opacity: meta.opacity ?? 1.0,
    strokePx: meta.strokePx || 0,
    strokeColor: meta.strokeColor || 'rgba(0,0,0,0.85)',
    shadowColor: meta.shadowColor || 'rgba(0,0,0,0.6)',
    shadowBlur: meta.shadowBlur ?? 12,
    shadowOffsetX: meta.shadowOffsetX ?? 0,
    shadowOffsetY: meta.shadowOffsetY ?? 2,
  };
}

// Preview function for overlay system
async function previewOverlayCaption() {
  if (!useOverlayMode || !overlaySystemInitialized) {
    console.warn('[overlay-preview] Overlay mode not ready:', {
      useOverlayMode,
      overlaySystemInitialized,
    });
    return;
  }

  try {
    const { getCaptionMeta } = await import('/js/caption-overlay.js');
    const meta = getCaptionMeta();
    console.log('[overlay-preview] Got overlay meta:', meta);

    const payload = overlayMetaToSSOT(meta);
    console.log('[overlay-preview] Sending payload:', payload);

    // DEBUG_PARITY: Log font details before save (gated by DEBUG_PARITY flag)
    if (window.DEBUG_PARITY) {
      console.log('[caption-overlay:save]', {
        fontFamily: meta.fontFamily,
        weightCss: meta.weightCss,
        fontStyle: meta.fontStyle,
        previewFontString: meta.previewFontString,
      });
    }

    const { apiFetch } = await import('/api.mjs');
    const result = await apiFetch('/caption/preview', { method: 'POST', body: payload });
    console.log('[overlay-preview] Server response:', result);

    // Store overlay preview meta to window.__lastCaptionOverlay for SSOT render payload
    if (result?.ok && result?.data) {
      window.__lastCaptionOverlay = {
        dataUrl: result.data.imageUrl,
        width: result.data.wPx || 1080,
        height: result.data.hPx || 1920,
        meta: result.data.meta || {},
      };
      console.log('[overlay-preview] Stored server meta:', window.__lastCaptionOverlay.meta);

      // AUDIT: Log after-save comparison
      console.info('[AUDIT:CLIENT:after-save]', {
        sent: normalizedPayload.previewFontString,
        returned: result.data.meta?.previewFontString,
        equal: normalizedPayload.previewFontString === result.data.meta?.previewFontString,
      });
    }

    const previewMedia = document.getElementById('previewMedia');
    if (previewMedia && (result?.previewUrl || result?.data?.imageUrl)) {
      previewMedia.src = result.previewUrl || result.data.imageUrl;
      console.log('[overlay-preview] Preview image set');
    }

    console.log('[overlay-preview] Preview generated successfully');
  } catch (error) {
    console.error('[overlay-preview] Failed:', error);
    // Do not fall back to legacy while overlay mode is ON (keeps SSOT)
  }
}

// Render function for overlay system
async function renderOverlayCaption() {
  if (!useOverlayMode || !overlaySystemInitialized) return;

  try {
    const { getCaptionMeta } = await import('/js/caption-overlay.js');
    const meta = getCaptionMeta();
    const payload = overlayMetaToSSOT(meta);

    const res = await fetch('/api/caption/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.detail || 'Render failed');
    }

    const { jobId, outputUrl } = await res.json();
    console.log('[overlay-render] Render job created:', jobId);

    // Handle job creation / redirect / poll as you already do
    // This would integrate with your existing render pipeline
  } catch (error) {
    console.error('[overlay-render] Failed:', error);
  }
}

// Regen helpers: only decrement on LLM actions
window.VAI = window.VAI || {};
VAI.state = VAI.state || { regensLeft: 10 };
(function initRegens() {
  const info = document.getElementById('regen-info');
  if (!info) return;
  const m = String(info.textContent || '').match(/(\d+)/);
  const initial = m ? parseInt(m[1], 10) : 10;
  if (!Number.isFinite(VAI.state.regensLeft)) VAI.state.regensLeft = initial;
  info.textContent = `Regens left: ${VAI.state.regensLeft}`;
})();
function setRegensLeft(n) {
  VAI.state.regensLeft = Math.max(0, Number(n || 0));
  const info = document.getElementById('regen-info');
  if (info) info.textContent = `Regens left: ${VAI.state.regensLeft}`;
}
function decRegens() {
  setRegensLeft((VAI.state.regensLeft | 0) - 1);
}
function showError(elementId, message) {
  const element = document.getElementById(elementId);
  if (!element) {
    if (message) console.warn('[showError] Target missing:', elementId, message);
    return;
  }
  element.textContent = message;
  element.classList.remove('hidden');
}

function hideError(elementId) {
  const element = document.getElementById(elementId);
  if (!element) return;
  element.classList.add('hidden');
}

function showBlockingError(title, msg) {
  alert(`${title}\n\n${msg}`);
}

function showToast(message, durationMs = 3000) {
  // Create toast element if it doesn't exist
  let toastEl = document.getElementById('article-toast');
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'article-toast';
    toastEl.className =
      'fixed bottom-5 left-1/2 transform -translate-x-1/2 bg-gray-900 dark:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm shadow-lg z-50 hidden';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  setTimeout(() => {
    toastEl.classList.add('hidden');
  }, durationMs);
}

// Show free limit reached modal with upgrade option
function showFreeLimitModal() {
  // Create modal if it doesn't exist
  let modal = document.getElementById('free-limit-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'free-limit-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    modal.innerHTML = `
                    <div class="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md mx-4 shadow-xl">
                        <h2 class="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">Free Limit Reached</h2>
                        <p class="text-gray-700 dark:text-gray-300 mb-6">You've used your 4 free shorts. Upgrade to keep creating unlimited shorts.</p>
                        <div class="flex gap-3">
                            <a href="/pricing.html" class="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-center font-semibold">View Plans</a>
                            <button onclick="document.getElementById('free-limit-modal').remove()" class="flex-1 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-4 py-2 rounded hover:bg-gray-300 dark:hover:bg-gray-600 font-semibold">Close</button>
                        </div>
                    </div>
                `;
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';

  // Close on outside click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

function showAuthRequiredModal() {
  // Create modal if it doesn't exist
  let modal = document.getElementById('auth-required-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'auth-required-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    modal.innerHTML = `
                    <div class="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md mx-4 shadow-xl">
                        <h2 class="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">Sign In Required</h2>
                        <p class="text-gray-700 dark:text-gray-300 mb-6">You need to sign in to create shorts. Sign up for free to get started!</p>
                        <div class="flex gap-3">
                            <a href="/plans.html#free" class="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-center font-semibold">Sign up free</a>
                            <button onclick="document.getElementById('auth-required-modal').remove()" class="flex-1 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-4 py-2 rounded hover:bg-gray-300 dark:hover:bg-gray-600 font-semibold">Close</button>
                        </div>
                    </div>
                `;
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';

  // Close on outside click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

function setLoading(buttonId, loading) {
  const button = document.getElementById(buttonId);
  button.disabled = loading;
  button.textContent = loading ? 'Loading...' : button.textContent.replace('Loading...', '');
}

// Load credits using existing system
async function refreshCredits(force = true, retries = 1) {
  if (!window.auth?.currentUser) {
    updateCreditUI(0);
    return;
  }
  try {
    // Use the apiFetch from the imported module
    const { apiFetch } = await import('/api.mjs');
    const data = await apiFetch('/credits', { method: 'GET' });
    const credits = Number(data?.credits ?? data?.data?.credits ?? 0);
    updateCreditUI(Number.isNaN(credits) ? 0 : credits);
  } catch (err) {
    if (retries > 0) return refreshCredits(false, retries - 1);
    console.warn('Credits fetch failed:', err);
  }
}

function updateCreditUI(credits) {
  currentCredits = typeof credits === 'number' ? credits : 0;
  const creditDisplay = document.getElementById('credit-display');
  const creditCount = document.getElementById('credit-count');
  if (creditDisplay) creditDisplay.classList.remove('hidden');
  if (creditCount) creditCount.textContent = String(currentCredits);
}

// Quote generation
async function generateQuote() {
  // [STUDIO] Block non-URL quote generation if legacy studio is disabled
  const text = document.getElementById('quote-text')?.value || '';
  if (!ENABLE_LEGACY_STUDIO && !isUrl(text)) {
    showError(
      'quote-error',
      'Legacy quote studio is disabled. Use Article Explainer for URL-based content.'
    );
    return;
  }

  if (!window.auth?.currentUser) {
    showError('quote-error', 'Please log in to generate quotes');
    return;
  }

  const tone = document.getElementById('quote-tone').value;

  if (!text.trim()) return;

  setLoading('generate-quote-btn', true);
  hideError('quote-error');

  try {
    const { apiFetch } = await import('/api.mjs');

    // Check if input is a URL - use story service for 4-6 sentence summaries
    if (isUrl(text)) {
      console.log('[generate-quote] Detected URL, using story service');

      // Step 1: Create story session
      const startResp = await apiFetch('/story/start', {
        method: 'POST',
        body: {
          input: text,
          inputType: 'link',
        },
      });

      if (!startResp.success || !startResp.data?.id) {
        if (startResp.error === 'AUTH_REQUIRED') {
          showAuthRequiredModal();
          return;
        }
        throw new Error(startResp.error || 'Failed to create story session');
      }

      const sessionId = startResp.data.id;

      // Store sessionId and URL for reuse in one-click short
      currentStorySessionId = sessionId;
      currentStoryUrl = text; // Store original URL

      // Step 2: Generate story (4-6 sentences)
      const generateResp = await apiFetch('/story/generate', {
        method: 'POST',
        body: {
          sessionId,
        },
      });

      if (!generateResp.success || !generateResp.data?.story?.sentences) {
        if (generateResp.error === 'AUTH_REQUIRED') {
          showAuthRequiredModal();
          return;
        }
        if (generateResp.error === 'FREE_LIMIT_REACHED') {
          showFreeLimitModal();
          return;
        }
        throw new Error(generateResp.error || 'Failed to generate story');
      }

      // Join sentences into a single text
      const sentences = generateResp.data.story.sentences;
      const joinedText = Array.isArray(sentences) ? sentences.join(' ') : String(sentences);

      // Create quote object from the summary
      currentQuote = {
        text: joinedText,
        author: null,
        toneTag: tone === 'default' ? undefined : tone,
      };

      // Update textarea with the full summary
      const quoteTextEl = document.getElementById('quote-text');
      if (quoteTextEl) {
        quoteTextEl.value = joinedText;
      }

      await displayQuote(currentQuote, { skipPreview: true });
      decRegens();

      // Update overlay if system is active
      if (useOverlayMode && overlaySystemInitialized && currentQuote?.text) {
        try {
          await maybeUpdateOverlay(currentQuote.text.trim(), true);
        } catch (e) {
          console.warn('[generate-quote] overlay update failed', e);
        }
      }
    } else {
      showError('quote-error', 'Quote generation is temporarily unavailable in this build.');
      return;
    }
  } catch (error) {
    showError('quote-error', error.message || 'Network error');
  } finally {
    setLoading('generate-quote-btn', false);
  }
}

// Expose to window scope for ui-actions.js
window.generateQuote = generateQuote;

async function displayQuote(quote, options = {}) {
  document.getElementById('quote-text-display').textContent = quote.text;
  const editEl = document.getElementById('quote-edit');
  editEl.value = quote.text;
  // Always keep the inlaid editor visible
  document.getElementById('quote-text-display').classList.add('hidden');
  editEl.classList.remove('hidden');
  document.getElementById('save-quote-btn').classList.remove('hidden');
  document.getElementById('cancel-quote-btn').classList.remove('hidden');
  document.getElementById('edit-quote-btn').classList.add('hidden');

  // Update char counter from textarea content
  try {
    const cc = document.getElementById('quote-char-count');
    if (cc) cc.textContent = `${Math.min(200, (editEl.value || '').length)}/200`;
  } catch {}
  document.getElementById('quote-author').textContent = quote.author ? `— ${quote.author}` : '';
  document.getElementById('quote-author').classList.toggle('hidden', !quote.author);
  document.getElementById('quote-tone-tag').textContent = quote.toneTag
    ? `Tone: ${quote.toneTag}`
    : '';
  document.getElementById('quote-tone-tag').classList.toggle('hidden', !quote.toneTag);
  document.getElementById('quote-result').classList.remove('hidden');
  // Always expose LLM iterate buttons when a quote is present
  const remix = document.getElementById('remix-buttons');
  if (remix) remix.classList.remove('hidden');
  updateRenderPreview();

  // Preview is handled by updateRenderPreview() which now shows container even without asset
}

// Asset loading with pagination and caching
async function loadAssets(page = 1) {
  // [STUDIO] Block asset search if legacy studio is disabled
  if (!ENABLE_LEGACY_STUDIO) {
    showError('asset-error', 'Legacy asset search is disabled. Use Article Explainer instead.');
    return;
  }

  if (currentAssetType === 'ai') return;
  if (!window.auth?.currentUser) {
    showError('asset-error', 'Please log in to load assets');
    return;
  }

  setLoading('search-assets-btn', true);
  hideError('asset-error');

  try {
    const { apiFetch } = await import('/api.mjs');
    const perPage = 12; // fuller grid per request
    const query = document.getElementById('asset-query').value;
    const cacheKey = `${currentAssetType}-${query}-${page}`;

    console.log('[assets] loadAssets called:', { type: currentAssetType, query, page });

    // Check cache first
    if (assetCache.has(cacheKey)) {
      const cachedData = assetCache.get(cacheKey);
      displayAssets(cachedData.items);
      hasMoreAssets = cachedData.nextPage;
      currentAssetPage = page;
      updatePagination();
      setLoading('search-assets-btn', false);
      console.log('[assets] Loaded from cache:', cacheKey);
      return;
    }

    const data = await apiFetch('/assets/options', {
      method: 'POST',
      body: {
        type: currentAssetType,
        query,
        page,
        perPage,
      },
    });

    if (data.ok) {
      console.log('[assets] Response received:', {
        meta: data.data.meta,
        count: data.data.items?.length,
      });

      // Cache the results
      assetCache.set(cacheKey, {
        items: data.data.items,
        nextPage: data.data.nextPage,
      });

      displayAssets(data.data.items);
      hasMoreAssets = data.data.nextPage;
      currentAssetPage = page;
      updatePagination();
    } else {
      showError('asset-error', data.reason || 'Failed to load assets');
    }
  } catch (error) {
    showError('asset-error', error.message || 'Network error');
  } finally {
    setLoading('search-assets-btn', false);
  }
}

// Expose to window scope for ui-actions.js
window.loadAssets = loadAssets;

function displayAssets(assets) {
  const grid = document.getElementById('asset-grid');
  grid.innerHTML = '';
  assets.forEach((asset) => {
    const assetElement = createAssetElement(asset);
    grid.appendChild(assetElement);
  });
}

function appendAssets(assets) {
  const grid = document.getElementById('asset-grid');
  assets.forEach((asset) => {
    const assetElement = createAssetElement(asset);
    grid.appendChild(assetElement);
  });
}

function createAssetElement(asset) {
  const div = document.createElement('div');
  div.className = `relative border-2 rounded overflow-hidden transition-colors group ${
    selectedAsset?.id === asset.id ? 'border-blue-500' : 'border-gray-700'
  }`;

  let media;
  if (asset.provider === 'ai' || asset.type === 'ai-generated') {
    media = `<img src="${asset.thumbUrl || asset.fileUrl}" alt="${asset.query}" class="w-full h-32 object-cover" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.src='/img/placeholder.svg'" />`;
  } else if (currentAssetType === 'images') {
    media = `<img src="${asset.thumbUrl || asset.fileUrl}" alt="${asset.query}" class="w-full h-32 object-cover" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.src='/img/placeholder.svg'" />`;
  } else {
    media = `<video src="${asset.fileUrl}" class="w-full h-32 object-cover" muted playsinline preload="metadata" onerror="this.style.display='none'"></video>`;
  }

  const attribution =
    asset.provider === 'ai'
      ? '<div class="text-purple-400 truncate">AI Generated</div>'
      : asset.photographer
        ? `<div class="text-gray-400 truncate">by ${asset.photographer}</div>`
        : '';

  div.innerHTML = `
                ${media}
                <div class="p-2 text-xs">
                    <div class="truncate">${asset.query}</div>
                    ${attribution}
                </div>
                <!-- Action Buttons Overlay -->
                <div class="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all duration-200 flex items-end justify-center pb-2 opacity-0 group-hover:opacity-100">
                    <div class="flex gap-2">
                        <button 
                            class="use-asset-btn px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors"
                            data-asset-id="${asset.id}"
                        >
                            Use
                        </button>
                        <button 
                            class="remix-asset-btn px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white text-xs rounded transition-colors"
                            data-asset-id="${asset.id}"
                        >
                            Remix
                        </button>
                    </div>
                </div>
            `;

  // Add event listeners for the buttons
  const useBtn = div.querySelector('.use-asset-btn');
  const remixBtn = div.querySelector('.remix-asset-btn');

  useBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    useAsset(asset);
  });

  remixBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    addToRemix(asset);
  });

  return div;
}

function selectAsset(asset) {
  selectedAsset = asset;
  // Re-render grid to update selection
  loadAssets(1);
  updateRenderPreview();
  updateRenderButtonState();

  // Trigger caption preview immediately after asset selection
  maybeGenerateCaptionPreview();
}

function updatePagination() {
  const container = document.getElementById('pagination-container');
  const prevBtn = document.getElementById('prev-page-btn');
  const nextBtn = document.getElementById('next-page-btn');
  const pageInfo = document.getElementById('page-info');

  if (currentAssetType === 'ai') {
    container.classList.add('hidden');
    return;
  }

  // Show pagination for non-AI asset types
  container.classList.remove('hidden');
  prevBtn.disabled = currentAssetPage <= 1;
  nextBtn.disabled = !hasMoreAssets;
  pageInfo.textContent = `Page ${currentAssetPage}`;
}

// Use asset function
async function useAsset(asset) {
  selectedAsset = asset;

  // Initialize window.state if needed
  if (!window.state) window.state = {};
  window.state.selectedAsset = asset;

  // Special handling for Pexels assets - high-quality preview
  if (asset.provider === 'pexels' && asset.src) {
    // Ensure the asset has the photo data for later use
    selectedAsset.photo = asset.src;
    await onPexelsUse(asset.src);
  }

  updateRenderPreview();
  updateRenderButtonState();

  // Show media + caption immediately in overlay (seamless flow with sync guarantee)
  try {
    await ensureOverlayActive();

    // Update overlay background with new media (wait for completion)
    if (useOverlayMode && overlaySystemInitialized) {
      await updateOverlayCanvasBackground();

      // Wait one frame to ensure canvas/media has painted
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const hasText = !!(currentQuote?.text || '').trim();
      console.log('[overlay-media] bg updated; hasText:', hasText);
    }

    // If we have a saved quote, show it on the new media
    const txt = (currentQuote?.text || '').trim();
    if (txt && useOverlayMode && overlaySystemInitialized) {
      await updateOverlayCaption(txt, true);
      console.log('[useAsset] Updated overlay caption');
    }

    // Ensure overlay is visible on top (final positioning)
    try {
      const { ensureOverlayTopAndVisible } = await import('/js/caption-overlay.js');
      ensureOverlayTopAndVisible('#stage');
    } catch {}
  } catch (e) {
    console.warn('[useAsset] overlay update failed', e);
  }

  // Legacy flow fallback
  if (currentQuote && !useOverlayMode) {
    updateLivePreview();
    updateCaptionOverlay(currentQuote.text.trim(), true);
  }

  // Scroll to render section (no-op if Quote DOM removed)
  const renderPreview = document.getElementById('render-preview');
  if (renderPreview) renderPreview.scrollIntoView({ behavior: 'smooth' });
}

// High-quality Pexels preview handler with race protection
async function onPexelsUse(photo) {
  const reqId = ++_previewReqId;
  _currentPexelsPhoto = photo; // Track for resize re-rendering

  const canvas = document.getElementById('live-preview-canvas');
  const container = canvas.parentElement;
  const cssW = container.clientWidth;
  const cssH = Math.round((cssW * 16) / 9);

  _setupHiDPICanvas(canvas, cssW, cssH);

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const previewUrl = _pexelsPreviewUrlFromPhoto(photo, cssW * dpr, cssH * dpr, 1.2);

  // Persist both URLs for later redraws (resize/caption)
  if (!window.state) window.state = {};
  window.state.selectedAsset = {
    ...(window.state.selectedAsset || {}),
    provider: 'pexels',
    id: photo?.id,
    thumbUrl: photo?.src?.medium,
    previewUrl,
  };

  // Also update the global selectedAsset to keep them in sync
  selectedAsset.previewUrl = previewUrl;

  console.log('[pexels-use] previewUrl', previewUrl);
  await _drawBackground(window.state.selectedAsset.previewUrl, canvas, cssW, cssH, 'bg:pexels-use');

  // Add write-trap to detect accidental overwrites
  try {
    const sa = window.state.selectedAsset;
    let _pv = sa.previewUrl;
    Object.defineProperty(sa, 'previewUrl', {
      get() {
        return _pv;
      },
      set(v) {
        if (!_isHiResPreviewUrl(v)) {
          console.warn('[trap] previewUrl being set to NON-hires url:', v);
        }
        _pv = v;
      },
    });
  } catch {}
}

// Add to remix function
function addToRemix(asset) {
  if (remixAssets.length >= 2) {
    showError('asset-error', 'Maximum 2 remix references allowed');
    return;
  }

  if (remixAssets.find((a) => a.id === asset.id)) {
    showError('asset-error', 'Asset already in remix references');
    return;
  }

  remixAssets.push(asset);
  updateRemixArea();
}

// Update remix area display
function updateRemixArea() {
  const remixArea = document.getElementById('remix-area');
  const remixAssetsContainer = document.getElementById('remix-assets');

  if (remixAssets.length === 0) {
    remixArea.classList.add('hidden');
    return;
  }

  remixArea.classList.remove('hidden');
  remixAssetsContainer.innerHTML = '';

  remixAssets.slice(0, 2).forEach((asset, index) => {
    const assetDiv = document.createElement('div');
    assetDiv.className = 'relative w-20 h-20 rounded overflow-hidden border border-gray-600';

    const media =
      asset.provider === 'ai' || asset.type === 'ai-generated'
        ? `<img src="${asset.thumbUrl || asset.fileUrl}" alt="${asset.query}" class="w-full h-full object-cover" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.src='/img/placeholder.svg'" />`
        : currentAssetType === 'images'
          ? `<img src="${asset.thumbUrl || asset.fileUrl}" alt="${asset.query}" class="w-full h-full object-cover" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.src='/img/placeholder.svg'" />`
          : `<video src="${asset.fileUrl}" class="w-full h-full object-cover" muted playsinline preload="metadata" onerror="this.style.display='none'"></video>`;

    assetDiv.innerHTML = `
                    ${media}
                    <button 
                        class="absolute -top-2 -right-2 w-5 h-5 bg-red-600 hover:bg-red-500 text-white text-xs rounded-full flex items-center justify-center"
                        onclick="removeFromRemix(${index})"
                    >
                        ×
                    </button>
                `;

    remixAssetsContainer.appendChild(assetDiv);
  });
}

// Remove from remix
function removeFromRemix(index) {
  remixAssets.splice(index, 1);
  updateRemixArea();
}

// Handle file upload
function handleFileUpload(files) {
  if (!files || !files[0]) return;
  const file = files[0];

  const reader = new FileReader();
  reader.onload = (e) => {
    const uploadedAsset = {
      id: `uploaded-${Date.now()}`,
      fileUrl: e.target.result,
      thumbUrl: e.target.result,
      query: file.name,
      provider: 'uploaded',
      type: file.type.startsWith('video/') ? 'video' : 'image',
    };

    uploadedAssets.push(uploadedAsset);

    // Add to current grid
    const grid = document.getElementById('asset-grid');
    const assetElement = createAssetElement(uploadedAsset);
    grid.insertBefore(assetElement, grid.firstChild);
  };

  if (file.type.startsWith('image/')) {
    reader.readAsDataURL(file);
  } else if (file.type.startsWith('video/')) {
    reader.readAsDataURL(file);
  }
}

function updateRenderPreview() {
  const preview = document.getElementById('render-preview');
  if (!preview) return;
  const renderBtn = document.getElementById('render-btn');

  // Show preview container if we have any feature selected
  if (currentQuote || selectedAsset || currentVoiceId) {
    // Handle quote display
    if (currentQuote) {
      document.getElementById('preview-quote').textContent = currentQuote.text;
    } else {
      document.getElementById('preview-quote').textContent = 'Quote: None';
    }

    // Show asset info if available
    if (selectedAsset) {
      document.getElementById('preview-asset').textContent =
        `Background: ${selectedAsset.provider === 'ai' ? 'AI Image' : selectedAsset.provider === 'uploaded' ? 'Uploaded' : `${currentAssetType} - ${selectedAsset.query}`}`;
    } else {
      document.getElementById('preview-asset').textContent = 'Background: Default (solid black)';
    }

    // Update caption style preview
    const font = document.getElementById('caption-font').value;
    const weight = document.getElementById('caption-weight').value;
    const size = window.getCaptionPx();
    const opacity = document.getElementById('caption-opacity').value;
    const placement = document.getElementById('caption-placement').value;
    const background = document.getElementById('caption-background').checked;

    document.getElementById('preview-caption-style').textContent =
      `Caption: ${font} ${weight}, ${size}px, ${opacity}% opacity, ${placement}${background ? ', with background' : ''}`;

    // Update voiceover preview
    const voiceId = document.getElementById('voiceover-voice').value;
    const selectedVoice = availableVoices.find((v) => v.id === voiceId);
    const voiceName = selectedVoice ? selectedVoice.name : 'Not selected';
    const stability = document.getElementById('tts-stability').value;
    const similarity = document.getElementById('tts-similarity').value;
    const style = document.getElementById('tts-style').value;
    const speakerBoost = document.getElementById('tts-speaker-boost').checked;

    // Show normalized style value (0-1 range) in preview
    const normalizedStyle = (parseInt(style) / 100).toFixed(2);
    document.getElementById('preview-voiceover').textContent =
      `Voice: ${voiceName} (Stability: ${stability}, Similarity: ${similarity}, Style: ${normalizedStyle}, Boost: ${speakerBoost ? 'On' : 'Off'})`;

    preview.classList.remove('hidden');
    // Always show render button when we have any feature
    renderBtn.classList.remove('hidden');
    // Always show preview container when we have any feature
    document.getElementById('live-preview-container').classList.remove('opacity-0');

    // Hide helper text when we have quote and background
    const helperText = document.getElementById('preview-helper-text');
    if (helperText) {
      if (currentQuote && selectedAsset) {
        helperText.classList.add('hidden');
      } else {
        helperText.classList.remove('hidden');
      }
    }

    // Wait a frame for the container to be visible, then update preview
    requestAnimationFrame(() => {
      // Ensure proper sequence: Container → Canvas → Preview → Caption
      console.log('[preview-init] Triggering preview sequence...');
      if (selectedAsset) {
        updateLivePreview();
      }
      if (currentQuote) {
        // Small delay to ensure preview is rendered before caption
        setTimeout(() => {
          if (useOverlayMode && overlaySystemInitialized) {
            updateOverlayCaption(currentQuote.text.trim(), true);
          } else {
            updateCaptionOverlay(currentQuote.text.trim(), true);
          }
        }, 100);
      }
    });
  } else {
    // No features selected - hide preview but keep button visible
    preview.classList.add('hidden');
    renderBtn.classList.remove('hidden'); // Keep button visible
    document.getElementById('live-preview-container').classList.add('opacity-0');

    // Show helper text when nothing is configured
    const helperText = document.getElementById('preview-helper-text');
    if (helperText) {
      helperText.classList.remove('hidden');
    }
  }
  updateRenderButtonState();
}

// Update caption style values
function updateCaptionStyleValues() {
  const px = window.getCaptionPx();
  document.getElementById('size-value').textContent = `${px}px`;
  document.getElementById('opacity-value').textContent =
    document.getElementById('caption-opacity').value + '%';
  document.getElementById('bg-opacity-value').textContent =
    document.getElementById('caption-bg-opacity').value + '%';
  updateRenderPreview();
  updateLivePreview();
  try {
    updateCaptionOverlay((currentQuote?.text || '').trim(), true);
  } catch {}
}

// Feature flag for preview fixes
window.__PREVIEW_FIX__ = true;

// Canvas ready state tracking
let canvasReadyState = { ready: false, observer: null, intersectionObserver: null };

// Fix B: Set the canvas backing store AFTER CSS size exists
function sizeCanvasToCSS(canvas) {
  const wCSS = canvas.clientWidth;
  const hCSS = canvas.clientHeight;

  console.log('[preview-init] Canvas sizing check:', {
    cssW: wCSS,
    cssH: hCSS,
    dpr: window.devicePixelRatio,
    canvasw: canvas.width,
    canvasH: canvas.height,
    rectWidth: canvas.getBoundingClientRect().width,
    rectHeight: canvas.getBoundingClientRect().height,
  });

  if (wCSS === 0 || hCSS === 0) {
    console.log('[preview-init] Canvas sized immediately:', {
      cssW: wCSS,
      cssH: hCSS,
      dpr: window.devicePixelRatio,
      canvasw: canvas.width,
      canvasH: canvas.height,
    });
    return false;
  }

  const dpr = window.devicePixelRatio || 1;
  const wBS = Math.round(wCSS * dpr);
  const hBS = Math.round(hCSS * dpr);

  if (canvas.width !== wBS || canvas.height !== hBS) {
    canvas.width = wBS;
    canvas.height = hBS;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  canvasReadyState.ready = true;
  return true;
}

// IntersectionObserver + ResizeObserver for robust canvas ready detection
function setupCanvasObserver() {
  if (!window.__PREVIEW_FIX__) return;

  const container = document.getElementById('live-preview-container');
  const canvas = document.getElementById('live-preview-canvas');
  if (!container || !canvas) return;

  // Clean up existing observers
  if (canvasReadyState.observer) {
    canvasReadyState.observer.disconnect();
  }
  if (canvasReadyState.intersectionObserver) {
    canvasReadyState.intersectionObserver.disconnect();
  }

  // Use IntersectionObserver to detect when container becomes visible
  canvasReadyState.intersectionObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          console.log('[canvas-ready] Container became visible, checking canvas');
          if (sizeCanvasToCSS(canvas)) {
            console.log('[canvas-ready] Canvas ready, triggering render');
            scheduleRender();
          }
        }
      }
    },
    { threshold: 0.1 }
  );

  // Use ResizeObserver for dimension changes
  canvasReadyState.observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        console.log('[canvas-ready] Container resized, checking canvas:', { width, height });
        if (sizeCanvasToCSS(canvas)) {
          console.log('[canvas-ready] Canvas ready, triggering render');
          scheduleRender();
        }
      }
    }
  });

  // Observe both intersection and resize
  canvasReadyState.intersectionObserver.observe(container);
  canvasReadyState.observer.observe(container);
}

// Idempotent render scheduler with RAF cancellation
let renderScheduled = false;
let renderRafId = null;
function scheduleRender() {
  if (!window.__PREVIEW_FIX__) return;
  if (renderScheduled) return;

  // Cancel any pending RAF to prevent stacking
  if (renderRafId !== null) {
    cancelAnimationFrame(renderRafId);
    renderRafId = null;
  }

  renderScheduled = true;
  renderRafId = requestAnimationFrame(() => {
    renderScheduled = false;
    renderRafId = null;
    if (canvasReadyState.ready && currentQuote?.text && selectedAsset) {
      console.log('[canvas-ready] Executing scheduled render');
      updateLivePreview();
      updateCaptionOverlay(currentQuote.text.trim(), true);
    }
  });
}

// Font parity map for client-side consistency
const FONT_MAP = {
  'DejaVu Sans': 'DejaVu Sans',
  'DejaVu Serif': 'DejaVu Serif',
};

// Helper function to derive yPct from placement
// Helper function for precise float conversion
function preciseFloat0to1(value) {
  // Fix: If value is already 0-1 range, don't divide by 100
  const numValue = Number(value);
  if (numValue <= 1) {
    return Math.max(0, Math.min(1, numValue));
  }
  // If value is 0-100 range, convert to 0-1
  return Math.max(0, Math.min(1, numValue / 100));
}

// Build proper payload with all controls wired
function buildCaptionPayload(text, captionStyle) {
  // SSOT: Check if overlay mode is enabled and use overlay metadata
  if (useOverlayMode && overlaySystemInitialized) {
    try {
      const { getCaptionMeta } = window;
      if (typeof getCaptionMeta === 'function') {
        const overlayMeta = getCaptionMeta();

        // Validate overlay meta has required fields
        if (overlayMeta && typeof overlayMeta.yPct === 'number' && overlayMeta.text) {
          console.log('[overlay-payload] Using overlay metadata:', overlayMeta);

          // Convert overlay meta to SSOT payload format
          return {
            text: overlayMeta.text || text,
            yPct: overlayMeta.yPct,
            xPct: overlayMeta.xPct,
            wPct: overlayMeta.wPct,
            fontFamily: overlayMeta.fontFamily,
            weightCss: overlayMeta.weightCss,
            sizePx: overlayMeta.fontPx,
            color: overlayMeta.color,
            opacity: overlayMeta.opacity,
            textAlign: overlayMeta.textAlign || 'center',
            padding: overlayMeta.paddingPx ?? 12,
            placement: 'custom', // SSOT: signals server to use manual placement
            maxWidthPct: Math.round((meta.wPct || 0.8) * 100),
            showBox: meta.showBox ?? true,
            boxColor: 'transparent',
            responsiveText: meta.responsiveText ?? true,
          };
        } else {
          console.warn('[overlay-payload] Overlay meta incomplete, falling back to legacy');
        }
      }
    } catch (error) {
      console.warn(
        '[overlay-payload] Failed to get overlay metadata, falling back to legacy:',
        error
      );
    }
  }

  // Legacy payload format (existing logic)
  const placement = captionStyle.placement || 'center';
  // SSOT-pure: Use CaptionGeom if available, otherwise default to bottom (0.80) and log error
  let yPct = captionStyle.yPct;
  if (typeof yPct !== 'number') {
    if (window.CaptionGeom?.yPctFromPlacement) {
      yPct = window.CaptionGeom.yPctFromPlacement(placement);
    } else {
      console.error('[caption] CaptionGeom not available, defaulting to bottom placement');
      yPct = 0.8; // Default to bottom if scripts fail
    }
  }
  const opacity = preciseFloat0to1(captionStyle.opacity || 80);

  const payload = {
    text,
    fontFamily: captionStyle.fontFamily || 'DejaVu Sans',
    weight: captionStyle.weightCss || captionStyle.weight || 'normal', // Fix: Use weightCss from captionStyle
    fontPx: captionStyle.fontPx || 48,
    opacity,
    placement,
    yPct,
  };

  console.log('[caption-overlay] payload:', {
    weight: payload.weight,
    opacity: payload.opacity,
    placement: payload.placement,
    yPct: payload.yPct,
    fontPx: payload.fontPx,
  });

  return payload;
}

// Fix C: Robust "wait for ready" without infinite loop
async function waitForCanvasReady(canvas, { timeoutMs = 2000 } = {}) {
  const start = performance.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const connected = canvas?.isConnected;
      const rect = canvas?.getBoundingClientRect();
      const container = document.getElementById('live-preview-container');
      const containerVisible = container && !container.classList.contains('hidden');
      const ready = connected && rect && rect.width > 0 && rect.height > 0 && containerVisible;

      if (ready && sizeCanvasToCSS(canvas)) {
        resolve(true);
        return;
      }
      if (performance.now() - start > timeoutMs) {
        reject(new Error('Canvas not ready: no size within timeout'));
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}

// Fix E: Initialize preview system with immediate canvas sizing
async function initPreviewSystem() {
  const canvas = document.getElementById('live-preview-canvas');
  const container = document.getElementById('live-preview-container');

  if (!canvas || !container) {
    console.warn('[preview-init] Canvas or container not found');
    return;
  }

  // Size canvas immediately from wrapper dimensions
  const wrapper = canvas.parentElement;
  const cssW = wrapper ? wrapper.clientWidth : 360; // fallback 360
  const cssH = wrapper ? wrapper.clientHeight : 640; // fallback 640

  // Set canvas.style.width/height in CSS pixels
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  // Set canvas.width/height in device pixels (multiply by devicePixelRatio)
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  console.log('[preview-init] Canvas sized immediately:', {
    cssW,
    cssH,
    dpr,
    canvasW: canvas.width,
    canvasH: canvas.height,
  });

  // Trigger initial preview if we have content
  if (currentQuote?.text && selectedAsset) {
    updateLivePreview();
    updateCaptionOverlay(currentQuote.text.trim(), true);
  }
}

// Manual trigger function for debugging
function forcePreviewUpdate() {
  console.log('[preview-debug] Forcing preview update');
  if (currentQuote && selectedAsset) {
    updateLivePreview();
    updateCaptionOverlay(currentQuote.text.trim(), true);
  } else {
    console.log('[preview-debug] Missing quote or asset:', {
      hasQuote: !!currentQuote,
      hasAsset: !!selectedAsset,
    });
  }
}

// Make it globally available for debugging
window.forcePreviewUpdate = forcePreviewUpdate;

// Initialize caption size UI (safe DOM ready wrapper)
function initCaptionSizeUI() {
  const el = document.getElementById('caption-size');
  const label = document.getElementById('size-value');
  if (!el || !label) return;

  function update() {
    try {
      const px = getCaptionPx(); // use the hoisted function
      label.textContent = `${px}px`;
      // refresh preview overlay without blocking rest of UI
      queueCaptionOverlayRefresh();
      // also update other caption style values
      if (typeof updateCaptionStyleValues === 'function') {
        updateCaptionStyleValues();
      }
    } catch (err) {
      console.error('[caption-size] update failed:', err);
    }
  }

  el.addEventListener('input', update);
  update(); // initial paint
}

/**
 * Actively load DejaVu Sans variants using Font Loading API
 * Returns true if all variants are ready, false if timeout/failure
 */
async function ensureDejaVuVariantsReady(timeoutMs = 3000) {
  // Wait for font set to be ready first
  try {
    await document.fonts.ready;
  } catch {}

  // Explicitly request each face we care about
  const descriptors = [
    '16px "DejaVu Sans"',
    'bold 16px "DejaVu Sans"',
    'italic 16px "DejaVu Sans"',
    'italic bold 16px "DejaVu Sans"',
  ];

  // Actively load them (Chrome/Firefox/Safari support)
  const loadAll = Promise.all(descriptors.map((d) => document.fonts.load(d)));

  // Optional timeout so we don't hang the UI forever
  await Promise.race([
    loadAll,
    new Promise((_, reject) => setTimeout(() => reject(new Error('font-load-timeout')), timeoutMs)),
  ]).catch((err) => {
    console.warn('[fonts] load() did not fully resolve:', err);
  });

  // Final check (now it should pass)
  const ok = descriptors.every((d) => document.fonts.check(d));
  if (!ok) console.warn('[fonts] check() still false for some faces');
  return ok;
}

// --- robust page bootstrap (run after DOM is ready)
// Wire Apply Caption Settings button
document.addEventListener('DOMContentLoaded', () => {
  const applyBtn = document.getElementById('apply-caption-style-btn');
  if (applyBtn) {
    applyBtn.addEventListener('click', applyCaptionStyle);
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  const hasQuoteUI = !!document.querySelector('[data-mode="quotes"]');
  // [STUDIO] Hide legacy quote/asset studio UI if disabled
  if (!ENABLE_LEGACY_STUDIO) {
    // Hide quotes tab button
    const quotesTab = document.getElementById('mode-quotes-tab');
    if (quotesTab) quotesTab.style.display = 'none';

    // Hide all quote-mode UI elements
    document.querySelectorAll('[data-mode="quotes"]').forEach((el) => {
      el.style.display = 'none';
    });

    // Initialize to articles mode (core feature)
    if (typeof window.setStudioMode === 'function') {
      window.setStudioMode('articles');
    }
  } else {
    // Legacy: Initialize studio mode to quotes (default)
    if (typeof window.setStudioMode === 'function') {
      window.setStudioMode('quotes');
    }
  }
  // Wrap each init so one failure doesn't stop the others
  const safe = (label, fn) => {
    try {
      fn && fn();
    } catch (e) {
      console.error(`[init] ${label} failed`, e);
    }
  };

  // Simple mobile mode: hide desktop Studio UI elements
  if (isSimpleMobile()) {
    console.log('[simple-mobile] enabled');

    // Hide all accordion headers (the chrome tabs)
    document.querySelectorAll('.accordion-header').forEach((header) => {
      markDesktopOnly(header, 'accordion-header');
    });

    // Hide Background and Voiceover sections (keep Quote section visible)
    document.querySelectorAll('.accordion-section').forEach((section) => {
      const header = section.querySelector('.accordion-header');
      if (header) {
        const sectionType = header.getAttribute('data-section');
        if (sectionType === 'media') {
          markDesktopOnly(section, 'Background section');
        } else if (sectionType === 'voice') {
          markDesktopOnly(section, 'Voiceover section');
        }
        // Quote section (data-section="quote") is NOT hidden - keep it visible
      }
    });

    // Hide mobile studio toolbar (tabs row)
    markDesktopOnly(document.getElementById('mobile-studio-toolbar'), 'mobile-studio-toolbar');

    // Hide desktop Create button
    markDesktopOnly(document.getElementById('render-btn'), 'render-btn (desktop Create)');

    // Hide mobile Create button
    markDesktopOnly(document.getElementById('mobile-create-btn'), 'mobile-create-btn');

    // Ensure One-Click Short buttons remain visible
    const oneClickBtn = document.getElementById('one-click-btn');
    if (oneClickBtn) oneClickBtn.style.display = '';
    const mobileOneClickBtn = document.getElementById('mobile-one-click-btn');
    if (mobileOneClickBtn) mobileOneClickBtn.style.display = '';
  }

  // AUDIT: Actively load fonts and check status
  if (document.fonts) {
    await ensureDejaVuVariantsReady(3000);
    console.info('[AUDIT:FONTS:client-load]', {
      regular: document.fonts.check('16px "DejaVu Sans"'),
      bold: document.fonts.check('bold 16px "DejaVu Sans"'),
      italic: document.fonts.check('italic 16px "DejaVu Sans"'),
      boldItalic: document.fonts.check('italic bold 16px "DejaVu Sans"'),
    });
  }

  // PRIORITY: Initialize assets after auth is ready (quote UI only)
  if (hasQuoteUI) {
    (async () => {
      try {
        console.log('[init] Starting asset browser initialization...');
        // Wait for auth to settle once, then decide what to do
        const ok = await ensureLoggedInOrWarn();
        // If logged in (or you want to allow anonymous browsing anyway), kick off first load
        if (ok) {
          const activeType = getActiveAssetType(); // 'images' | 'videos' | 'ai'
          const q = (document.getElementById('asset-query')?.value || 'nature').trim();
          const grid =
            document.getElementById(`${activeType}-grid`) ||
            document.querySelector(`[data-grid="${activeType}"]`) ||
            document.getElementById('asset-grid');

          console.log('[assets] Checking initial load:', {
            activeType,
            gridEmpty: grid?.childElementCount === 0,
            query: q,
          });

          if (grid && grid.childElementCount === 0) {
            console.log('[assets] Loading initial assets for', activeType);
            if (typeof loadAssets === 'function') {
              currentAssetType = activeType; // Set the global state
              await loadAssets(1); // Wait for assets to load
            } else {
              console.warn('[assets] loadAssets function not found');
            }
          }
        }
      } catch (e) {
        console.error('[init] Asset browser initialization failed:', e);
      }
    })();
  }

  // Trigger caption preview if we have text and asset (legacy fallback only)
  safe('caption-preview-init', () => maybeGenerateCaptionPreview());

  // Default to overlay mode as soon as caption exists
  safe('overlay-default', () => {
    const hasCaption = !!(currentQuote?.text || document.getElementById('quote-text')?.value);
    if (hasCaption) ensureOverlayActive();
  });

  // SECONDARY: Initialize caption UI (non-blocking)
  safe('caption-size', () => typeof initCaptionSizeUI === 'function' && initCaptionSizeUI());

  // Asset browser setup is now handled above in priority section
  // Tab switching is now handled by the delegated router in ui-actions.js

  // Initialize draft storyboard on page load if no session exists
  if (!window.currentStorySessionId) {
    if (!window.draftStoryboard) {
      // Phase 1: Start with 1 empty beat instead of 8
      window.draftStoryboard = { beats: [{ id: generateBeatId(), text: '', selectedClip: null }] };
    }
    renderDraftStoryboard();
    updateRenderArticleButtonState();
  }
});

// Move Caption Style section below storyboard when DOM is ready
// Isolated listener ensures it runs even if main DOMContentLoaded handler throws
document.addEventListener('DOMContentLoaded', function ensureCaptionStyleMounted() {
  try {
    const mount = document.getElementById('caption-style-mount');
    const section = document.getElementById('caption-style-section');

    if (!mount || !section) {
      console.warn('[caption-style] Mount point or section not found');
      return;
    }

    // Only move if not already in mount (avoid duplicate moves)
    if (section.parentElement !== mount) {
      // Remove inline display:none (section will inherit visibility from storyboard)
      section.style.display = '';
      mount.appendChild(section);
      console.log('[caption-style] Moved Caption Style section below storyboard');
    }
  } catch (e) {
    console.error('[caption-style] Failed to move section:', e);
    // Non-fatal: section remains in original location, just hidden
  }
});

// Update render button state based on validation
function updateRenderButtonState() {
  console.log(
    '[render-validate] updateRenderButtonState called from:',
    new Error().stack?.split('\n')[2]?.trim() || 'unknown'
  );

  const renderBtn = document.getElementById('render-btn');
  if (!renderBtn) return;
  const hasValidAsset = selectedAsset && (selectedAsset.fileUrl || selectedAsset.url);
  const hasQuote = currentQuote;
  const hasVoiceover = !!currentVoiceId;
  const isLoggedIn = window.auth?.currentUser;

  console.log('[render-validate] Basic conditions:', {
    hasValidAsset,
    hasQuote,
    hasVoiceover,
    isLoggedIn: !!isLoggedIn,
    selectedAsset: selectedAsset?.url || selectedAsset?.fileUrl || 'none',
  });

  // NEW: Check if preview is saved AND current text matches saved text (SSOT workflow)
  let hasSavedPreview = false;

  // Debug: Log all validation conditions
  console.log('[render-validate] Checking preview state:', {
    hasGetSavedMeta: !!window.getSavedOverlayMeta,
    hasGetCaptionMeta: !!window.getCaptionMeta,
    flagSet: window._previewSavedForCurrentText,
    flagType: typeof window._previewSavedForCurrentText,
  });

  if (window.getSavedOverlayMeta && window.getCaptionMeta && window._previewSavedForCurrentText) {
    console.log('[render-validate] All conditions met, checking meta...');

    const savedMeta = window.getSavedOverlayMeta();
    console.log('[render-validate] Saved meta exists:', !!savedMeta);

    if (savedMeta) {
      try {
        const currentMeta = window.getCaptionMeta();
        console.log('[render-validate] Current meta exists:', !!currentMeta);

        // Normalize text for comparison - collapse all whitespace to single spaces
        const normalizeTextForComparison = (text) => {
          return (text || '')
            .replace(/\s*\n\s*/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        };

        // Use textRaw if available (preserves user input), fallback to text
        const savedTextRaw = savedMeta.textRaw || savedMeta.text || '';
        const currentTextRaw = currentMeta.textRaw || currentMeta.text || '';

        // Normalize for comparison
        const savedText = normalizeTextForComparison(savedTextRaw);
        const currentText = normalizeTextForComparison(currentTextRaw);

        console.log('[render-validate] Text comparison:', {
          savedLength: savedText.length,
          currentLength: currentText.length,
          match: savedText === currentText,
          savedNormalized: savedText.substring(0, 100),
          currentNormalized: currentText.substring(0, 100),
          savedRaw: savedTextRaw.substring(0, 100),
          currentRaw: currentTextRaw.substring(0, 100),
        });

        // Preview is valid if flag is set AND text matches
        hasSavedPreview = savedText === currentText;

        if (!hasSavedPreview && savedText && currentText && savedText !== currentText) {
          console.log('[preview-state] Text mismatch detected - saved vs current differ');
        }
      } catch (err) {
        console.warn('[preview-state] Error comparing caption text:', err);
        hasSavedPreview = false;
      }
    } else {
      console.log('[render-validate] No saved meta found');
    }
  } else {
    console.log('[render-validate] Prerequisites not met:', {
      getSavedOverlayMeta: !!window.getSavedOverlayMeta,
      getCaptionMeta: !!window.getCaptionMeta,
      previewSavedFlag: window._previewSavedForCurrentText,
    });
  }

  console.log('[render-validate] Final hasSavedPreview:', hasSavedPreview);

  // Render requires: features + logged in (preview will be saved on-demand)
  const canRender = (hasQuote || hasValidAsset || hasVoiceover) && isLoggedIn;

  console.log('[render-validate] Final render decision:', {
    hasQuote,
    hasValidAsset,
    hasVoiceover,
    isLoggedIn: !!isLoggedIn,
    hasSavedPreview,
    canRender,
    buttonWillBeDisabled: !canRender,
  });

  renderBtn.disabled = !canRender;

  // Also update mobile Create button state
  const mobileCreateBtn = document.getElementById('mobile-create-btn');
  if (mobileCreateBtn) {
    mobileCreateBtn.disabled = !canRender;
  }

  if (!canRender) {
    let reason = '';
    if (!isLoggedIn) reason = 'Please log in';
    else if (!hasQuote && !hasValidAsset && !hasVoiceover)
      reason = 'Please add a quote, select media, or choose a voiceover';
    else if (!hasSavedPreview) reason = 'Save preview first';

    console.log('[render-validate] Button disabled, reason:', reason);
    renderBtn.title = reason;
    if (mobileCreateBtn) mobileCreateBtn.title = reason;
  } else {
    console.log('[render-validate] Button ENABLED - ready to render!');
    renderBtn.title = 'Ready to render with saved preview';
    if (mobileCreateBtn) mobileCreateBtn.title = 'Ready to render with saved preview';
  }
}

// Fix C: Live preview functionality without infinite retry
function updateLivePreview() {
  if (!currentQuote || !selectedAsset) return;

  const container = document.getElementById('live-preview-container');
  const canvas = document.getElementById('live-preview-canvas');

  // Check if container is visible first - allow opacity-0 if container has dimensions
  if (!container || container.offsetParent === null) {
    console.log('[preview-scaling] Container not visible, skipping preview');
    return;
  }

  // If container has opacity-0 but has dimensions, proceed (will be made visible)
  if (container.classList.contains('opacity-0')) {
    console.log('[preview-scaling] Container has opacity-0 but has dimensions, proceeding...');
  }

  // Fix C: Check if canvas has real dimensions, with improved retry logic
  if (!canvas || canvas.clientWidth === 0 || canvas.clientHeight === 0) {
    console.log('[preview-scaling] Canvas not ready, scheduling retry...');
    // Force canvas sizing if container has dimensions
    if (container && container.clientWidth > 0 && container.clientHeight > 0) {
      console.log('[preview-scaling] Container has dimensions, forcing canvas sizing...');
      const wrapper = canvas.parentElement;
      if (wrapper) {
        canvas.style.width = `${wrapper.clientWidth}px`;
        canvas.style.height = `${wrapper.clientHeight}px`;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(wrapper.clientWidth * dpr);
        canvas.height = Math.round(wrapper.clientHeight * dpr);
        console.log('[preview-scaling] Canvas force-sized:', {
          cssW: canvas.clientWidth,
          cssH: canvas.clientHeight,
          canvasW: canvas.width,
          canvasH: canvas.height,
        });
      }
    }

    // Retry once on next frame
    requestAnimationFrame(() => {
      const retryCanvas = document.getElementById('live-preview-canvas');
      if (retryCanvas && retryCanvas.clientWidth > 0 && retryCanvas.clientHeight > 0) {
        console.log('[preview-scaling] Canvas ready on retry, proceeding...');
        updateLivePreview();
      } else {
        console.warn('[preview-scaling] Canvas still not ready after retry, skipping preview');
      }
    });
    return;
  }

  container.classList.remove('opacity-0');

  // If a <video> is present for preview, hide overlay to avoid double text
  try {
    const ov = document.getElementById('caption-overlay');
    const hasVideo = !!document.querySelector(
      '#live-preview-container video, #preview-holder video'
    );
    if (ov) ov.style.display = hasVideo ? 'none' : 'block';
  } catch {}

  // 9:16 CSS sizing + HiDPI backing
  const { cssW, cssH } = layoutPreviewDims();
  const { ctx } = _setupHiDPICanvas(canvas, cssW, cssH);

  // Choose the background URL from whatever the app thinks it should be
  let url =
    selectedAsset?.previewUrl ||
    selectedAsset?.url ||
    selectedAsset?.thumbUrl ||
    selectedAsset?.fileUrl;

  // >>> Insert this one line to force hi-res for Pexels:
  url = _ensureHiResPreviewUrl(url, canvas);

  // Load & draw the background
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.src = url;

  img.onload = () => {
    // COVER draw (no stretching)
    drawCover(ctx, img, cssW, cssH);

    // Debug
    window._currentPreviewUrl = url;
    _tapCanvas('bg:updateLivePreview');
  };
}

function drawCaptionOverlay(ctx, canvasWidth, canvasHeight) {
  if (!currentQuote) return;

  const font = document.getElementById('caption-font').value;
  const weight = document.getElementById('caption-weight').value;
  const size = window.getCaptionPx();
  const opacity = parseInt(document.getElementById('caption-opacity').value) / 100;
  const placement = document.getElementById('caption-placement').value;
  const showBackground = document.getElementById('caption-background').checked;
  const bgOpacity = parseInt(document.getElementById('caption-bg-opacity').value) / 100;

  // Set font - ensure weight mapping matches FFmpeg
  const cssWeight =
    String(weight).toLowerCase() === 'bold' || Number(weight) >= 600 ? 'bold' : 'normal';
  ctx.font = `${cssWeight} ${size}px ${getFontFamily(font)}`;
  ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Add stroke to match FFmpeg rendering
  ctx.lineWidth = 3;
  ctx.strokeStyle = `rgba(0, 0, 0, 0.85)`;
  ctx.miterLimit = 2;

  // Calculate text position
  let y;
  const padding = 20;
  switch (placement) {
    case 'top':
      y = padding + size / 2;
      break;
    case 'middle':
      y = canvasHeight / 2;
      break;
    case 'bottom':
      y = canvasHeight - padding - size / 2;
      break;
  }

  // Wrap text if needed
  const maxWidth = canvasWidth - 40;
  const words = currentQuote.text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine + (currentLine ? ' ' : '') + word;
    const metrics = ctx.measureText(testLine);

    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  // Draw background if enabled
  if (showBackground) {
    const lineHeight = size * 1.2;
    const totalHeight = lines.length * lineHeight;
    const bgY = y - totalHeight / 2;
    const bgHeight = totalHeight + padding;
    const bgWidth = canvasWidth - 20;

    ctx.fillStyle = `rgba(0, 0, 0, ${bgOpacity})`;
    ctx.fillRect(10, bgY - padding / 2, bgWidth, bgHeight);
  }

  // Draw text lines
  ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
  const lineHeight = size * 1.2;
  const startY = y - ((lines.length - 1) * lineHeight) / 2;

  lines.forEach((line, index) => {
    const x = canvasWidth / 2;
    const y = startY + index * lineHeight;

    // Draw stroke first (matches FFmpeg layering)
    ctx.strokeText(line, x, y);
    // Draw fill text on top
    ctx.fillText(line, x, y);
  });
}

function getFontFamily(font) {
  const fontMap = {
    system: 'DejaVu Sans Local, system-ui, -apple-system, sans-serif',
    bold: 'DejaVu Sans Local, system-ui, -apple-system, sans-serif',
    cinematic: 'DejaVu Sans Local, Georgia, serif',
    minimal: 'DejaVu Sans Local, Helvetica, Arial, sans-serif',
  };
  return fontMap[font] || 'DejaVu Sans Local, system-ui, sans-serif';
}

// Compute preview-fitted lines using canvas metrics to mirror overlay width
function computeFittedTextForPreview(text, { font, weight, sizePx, previewWidthPx }) {
  try {
    const raw = String(text || '').trim();
    if (!raw) {
      return '';
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const family = 'DejaVu Sans Local';
    const weightCss = String(weight).toLowerCase() === 'bold' ? '700' : '400';
    const size = Math.max(10, Number(sizePx) || 48);
    ctx.font = `${weightCss} ${size}px ${family}`;

    // Match overlay: max content width ≈ 92% of preview width
    const maxWidth = Math.max(20, Math.round((Number(previewWidthPx) || 360) * 0.92));

    const words = raw.split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w;
      const width = ctx.measureText(next).width;
      if (width > maxWidth && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = next;
      }
    }
    if (cur) lines.push(cur);

    const result = lines.join('\n');
    return result;
  } catch (error) {
    return String(text || '').trim();
  }
}

// Voice loading and preview functions
window.loadVoices = async function loadVoices() {
  showError('voice-preview-status', 'Voice loading is temporarily unavailable in this build.');
  try {
    showToast('Voice loading is temporarily unavailable in this build.');
  } catch {}
};

function populateVoiceSelect() {
  const select =
    document.getElementById('voiceover-voice') || document.getElementById('article-voice-preset');
  if (!select) return;
  const retryBtn = document.getElementById('retry-voices-btn');
  select.innerHTML = '';

  if (availableVoices.length === 0) {
    select.innerHTML = '<option value="">No voices available</option>';
    if (retryBtn) retryBtn.title = 'Retry loading voices';
    return;
  }

  availableVoices.forEach((voice) => {
    const option = document.createElement('option');
    option.value = voice.id;
    option.textContent = `${voice.name} - ${voice.description}`;
    select.appendChild(option);
  });

  // Enable preview button and hide retry button (only if elements exist)
  const previewBtn = document.getElementById('preview-voice-btn');
  if (previewBtn) previewBtn.disabled = false;
  if (retryBtn) retryBtn.style.display = 'none';
}

async function previewVoice() {
  const voiceSelect = document.getElementById('voiceover-voice');
  const voiceId = voiceSelect.value;

  if (!voiceId || voiceId === '') {
    showError('voice-preview-status', 'Please select a voice');
    return;
  }

  const statusEl = document.getElementById('voice-preview-status');
  const previewBtn = document.getElementById('preview-voice-btn');
  const audioEl = document.getElementById('voice-preview-audio');

  statusEl.classList.remove('hidden');
  statusEl.textContent = 'Generating preview...';
  previewBtn.disabled = true;

  try {
    // Get TTS settings from UI and normalize to 0-1 range
    const stability = parseFloat(document.getElementById('tts-stability').value);
    const similarity_boost = parseFloat(document.getElementById('tts-similarity').value);
    const style = parseInt(document.getElementById('tts-style').value);
    const use_speaker_boost = document.getElementById('tts-speaker-boost').checked;

    // Normalize style from 0-100 to 0-1 range
    const normalizedStyle = Math.max(0, Math.min(1, style / 100));

    // Get caption text for preview if available, otherwise use default
    const captionText =
      document.getElementById('quote-text-display')?.textContent?.trim() ||
      document.getElementById('quote-edit')?.value?.trim() ||
      'Hello, this is a preview of my voice. How does it sound?';

    // Trim caption if too long (max ~240 chars for preview)
    const previewText =
      captionText.length > 240 ? captionText.substring(0, 240) + '...' : captionText;

    const ttsPayload = {
      text: previewText,
      voiceId,
      modelId: 'eleven_multilingual_v2',
      outputFormat: 'mp3_44100_128',
      voiceSettings: {
        stability,
        similarity_boost,
        style: normalizedStyle, // Now 0-1 range
        use_speaker_boost,
      },
    };

    console.log('[tts.preview] POST /api/tts/preview', {
      voiceId,
      settings: ttsPayload.voiceSettings,
    });

    const { apiFetch } = await import('/api.mjs');
    const data = await apiFetch('/tts/preview', {
      method: 'POST',
      body: ttsPayload,
    });

    console.log('[tts.preview] Response received:', {
      success: data.success,
      hasAudio: !!data.data?.audio,
    });

    if (data.success) {
      audioEl.src = data.data.audio;
      audioEl.classList.remove('hidden');
      statusEl.textContent = 'Preview ready - click play to listen';

      // Auto-play the preview
      audioEl.play().catch((e) => {
        console.warn('[tts.preview] Autoplay prevented:', e.message);
        statusEl.textContent = 'Preview ready - click play to listen';
      });
      console.log('[tts.preview] Playing preview audio');
    } else {
      console.error('[tts.preview] Failed:', data.error || 'Unknown error');
      showError('voice-preview-status', data.error || 'Failed to generate preview');
    }
  } catch (error) {
    console.error('[tts.preview] Error:', error);
    showError('voice-preview-status', error.message || 'Network error');
  } finally {
    previewBtn.disabled = false;
  }
}

// Helper function for better error messages
function summarizeCreateError(err) {
  try {
    const msg = String(err?.message || err);
    const json = JSON.parse(msg.replace(/^Error:\s*/, ''));
    const fe = json?.detail?.fieldErrors || {};
    if (fe.caption?.length) return `Caption: ${fe.caption.join(', ')}`;
  } catch {}
  return null;
}

// Helper functions for payload construction
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// Drop undefined keys before fetch; keeps payload clean
function stripUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

// Convert placement/% to absolute yPx_png
function toRasterYPx({ frameH, rasterH, placement, yPct, internalPaddingPx }) {
  const pad = Number.isFinite(internalPaddingPx)
    ? internalPaddingPx
    : Math.round((yPct ?? 0) * frameH);
  if (placement === 'bottom') return frameH - rasterH - pad;
  if (placement === 'center') return Math.round((frameH - rasterH) / 2);
  return pad; // top
}

// Integer/non-negative normalization for server strict validation
function int(n) {
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function nonneg(n) {
  return Math.max(0, int(n));
}

// Extract clean text from the preview editor (SSOT for caption text)
function getEditorPlainText() {
  // Use the preview content as the SSOT for text
  const el = document.querySelector('.caption-box .content');
  if (!el) {
    console.warn('[getEditorPlainText] No .caption-box .content element found');
    return { textRaw: '', text: '' };
  }

  // innerText preserves line breaks; normalize them to spaces for `text`
  const raw = (el.innerText || '').trim();
  return {
    textRaw: raw, // keep line breaks for debugging if you like
    text: raw
      .replace(/\s*\n\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(), // schema expects a string; no HTML
  };
}

function normalizeRasterPayload(p) {
  // Extract text from DOM as SSOT (guarantees text always exists)
  const { text, textRaw } = getEditorPlainText();

  // Use existing lines if present; otherwise derive from text
  const safeLines =
    Array.isArray(p.lines) && p.lines.length
      ? p.lines
      : text
        ? text.split(/\s*\n\s*/g).filter(Boolean)
        : [];

  return {
    ...p,

    // ✅ Force-fill text fields (server schema-friendly)
    text: (p.text && p.text.trim() ? p.text.trim() : text).trim(),
    textRaw: (p.textRaw && p.textRaw.trim() ? p.textRaw.trim() : textRaw).trim(),

    // Use safe lines array
    lines: safeLines,

    // integers the server expects
    frameW: int(p.frameW),
    frameH: int(p.frameH),
    rasterW: int(p.rasterW),
    rasterH: int(p.rasterH),
    rasterPadding: int(p.rasterPadding || 0),
    fontPx: int(p.fontPx),

    // Client canonical values (required for V3 raster)
    clientRasterW: int(p.clientRasterW || p.rasterW),
    clientRasterH: int(p.clientRasterH || p.rasterH),
    clientRasterPadding: int(p.clientRasterPadding || p.rasterPadding || 0),
    lineSpacingPx: int(p.lineSpacingPx),
    letterSpacingPx: int(p.letterSpacingPx || 0),
    totalTextH: int(p.totalTextH),
    yPxFirstLine: int(p.yPxFirstLine),

    // placement must be >= 0
    xPx_png: nonneg(p.xPx_png ?? 0),
    yPx_png: int(p.yPx_png ?? 0),

    // strings – ensure they're present
    fontFamily: String(p.fontFamily || ''),
    fontStyle: String(p.fontStyle || 'normal'),
    weightCss: String(p.weightCss || '400'),
    previewFontString: String(p.previewFontString || ''),

    // remove percent fields to avoid ambiguity in raster mode
    xPct: undefined,
    yPct: undefined,
    wPct: undefined,
  };
}

// Reset preview saved state when caption text changes
function resetPreviewSavedState() {
  console.log('[preview-state] Resetting preview saved state - caption changed');

  // Hide Preview Saved status indicator
  const statusContainer = document.querySelector('#preview-status');
  if (statusContainer) {
    statusContainer.innerHTML = '';
    statusContainer.classList.add('hidden');
  }

  // Mark saved preview as stale (don't clear localStorage, just invalidate flag)
  window._previewSavedForCurrentText = false;

  // Update render button state (will disable it since preview is no longer saved)
  updateRenderButtonState();
}

// ---- Browser-as-Visual-Truth Helper Functions ----

// Parse pixel values safely
const px = (v) => (typeof v === 'number' ? v : parseFloat(v || 0)) || 0;

// Convert CSS px (preview) -> frame px (e.g., 1080x1920)
function toFramePx(cssPx, { frameW, previewCssW }) {
  const scale = frameW / previewCssW; // e.g., 1080 / 360 = 3
  return Math.round(cssPx * scale);
}

// Collect computed styles we need (what the user actually sees)
function readComputed(el) {
  const cs = getComputedStyle(el);
  const fontPx = Math.round(px(cs.fontSize)); // ✅ Round immediately
  const lineHeightPx =
    cs.lineHeight === 'normal'
      ? Math.ceil(fontPx * 1.2) // browser default fallback
      : Math.round(px(cs.lineHeight)); // ✅ Round
  const lineSpacingPx = Math.max(0, Math.round(lineHeightPx - fontPx)); // ✅ Round
  const letterSpacingPx = Math.round(px(cs.letterSpacing)); // ✅ Round

  return {
    fontFamily: cs.fontFamily,
    fontStyle: cs.fontStyle,
    weightCss: cs.fontWeight,
    fontPx,
    lineHeightPx,
    lineSpacingPx,
    letterSpacingPx,
  };
}

// Build raster geometry exactly like the user sees
function buildRasterFromBrowser({
  stageEl, // the draggable/resize box element (POSITIONED)
  contentEl, // the inner text element (where computed styles apply)
  frameW = 1080, // video width
  frameH = 1920, // video height
  previewCssW, // CSS width of the live preview (e.g., 360)
}) {
  // 1) Styles (browser truth)
  const s = readComputed(contentEl);

  // 2) Visual lines - use stable line extraction with retry and caching
  const metrics = {
    fontPx: s.fontPx,
    lineSpacingPx: s.lineSpacingPx,
  };
  const extractionResult = window.extractLinesStable(contentEl, metrics);
  const lines = extractionResult.lines;
  const linesCount = Math.max(1, lines.length);

  // Log extraction result for debugging
  console.log('[lines:save]', {
    source: extractionResult.source,
    count: lines.length,
    clientWidth: contentEl.clientWidth,
    maxWidthUsed:
      contentEl.clientWidth -
      (parseInt(getComputedStyle(contentEl).paddingLeft, 10) || 0) -
      (parseInt(getComputedStyle(contentEl).paddingRight, 10) || 0),
    fontPx: metrics.fontPx,
    lineSpacingPx: metrics.lineSpacingPx,
  });

  // 3) Get container for relative positioning
  const stageContainer = stageEl.parentElement || stageEl;
  const containerRect = stageContainer.getBoundingClientRect();
  const box = stageEl.getBoundingClientRect();

  // Calculate position relative to container (not viewport)
  const relativeTopCss = box.top - containerRect.top;
  const relativeLeftCss = box.left - containerRect.left;

  // 4) Convert typography to frame pixels
  const fontPxFrame = toFramePx(s.fontPx, { frameW, previewCssW });
  const lineSpacingPxFrame = toFramePx(s.lineSpacingPx, { frameW, previewCssW });
  const letterSpacingPxFrame = toFramePx(s.letterSpacingPx, { frameW, previewCssW });

  // 5) Calculate totalTextH in frame space
  const totalTextHFrame = fontPxFrame * linesCount + lineSpacingPxFrame * (linesCount - 1);

  // 6a) Read actual padding from content element (if any)
  const sContent = getComputedStyle(contentEl);
  const contentPadTopCss = parseFloat(sContent.paddingTop) || 0;
  const paddingFramePx = Math.round(toFramePx(contentPadTopCss, { frameW, previewCssW }));

  // 6b) Convert to frame pixels
  const rW = toFramePx(box.width, { frameW, previewCssW });

  // Use CaptionGeom to compute rasterH with descender/shadow safety
  const shadow = window.CaptionGeom
    ? window.CaptionGeom.parseShadow(sContent.textShadow)
    : { blur: 12, y: 2 };
  const rH = window.CaptionGeom
    ? window.CaptionGeom.computeRasterH({
        totalTextH: totalTextHFrame,
        padTop: paddingFramePx,
        padBottom: paddingFramePx,
        shadowBlur: shadow.blur,
        shadowOffsetY: shadow.y,
      })
    : totalTextHFrame + paddingFramePx * 2;

  const xPx_png = toFramePx(relativeLeftCss, { frameW, previewCssW });
  let yPx_png = toFramePx(relativeTopCss, { frameW, previewCssW });

  // Clamp negative yPx_png to 0 as safety net (overlay may be off-screen on mobile)
  if (yPx_png < 0) {
    console.warn('[browser-geom] Clamping negative yPx_png:', yPx_png, '-> 0');
    yPx_png = 0;
  }

  // Compute asymmetric padding
  const padTop = paddingFramePx;
  const padBottom =
    paddingFramePx +
    (window.CaptionGeom
      ? window.CaptionGeom.DESCENDER_PAD +
        window.CaptionGeom.SHADOW_BLUR_DEFAULT +
        Math.max(0, shadow.y)
      : 0);

  console.log('[browser-geom]', {
    rW,
    rH,
    yPx_png,
    yPxFirstLine: yPx_png + paddingFramePx,
    padTop,
    padBottom,
    lines: lines.length,
  });

  return {
    // DOM truth - correct field names for server
    lines, // string[] - the actual line text (server derives count from lines.length)
    totalTextH: totalTextHFrame, // Frame pixels
    yPxFirstLine: yPx_png + paddingFramePx,

    // Fonts & spacing (converted to frame space)
    fontPx: fontPxFrame,
    lineSpacingPx: lineSpacingPxFrame,
    letterSpacingPx: letterSpacingPxFrame,
    fontFamily: 'DejaVu Sans', // Always send base family
    fontStyle: s.fontStyle,
    weightCss: s.weightCss,
    previewFontString: (() => {
      const baseFamily = 'DejaVu Sans';
      const weightToken =
        String(s.weightCss) === '700' || s.weightCss === 'bold' ? 'bold' : 'normal';
      return `${s.fontStyle} ${weightToken} ${fontPxFrame}px "${baseFamily}"`;
    })(),

    // Raster box (tight to the content box)
    rasterW: rW,
    rasterH: rH,
    rasterPadding: paddingFramePx, // legacy
    padTop,
    padBottom,

    // Placement in frame space
    xPx_png, // or use xExpr_png='(W-overlay_w)/2' if you center
    yPx_png,

    // Frame (unchanged)
    frameW,
    frameH,
  };

  // Font parity verification log
  console.log('[font-parity:client]', {
    previewFontString: browserGeometry.previewFontString,
    fontFamily: browserGeometry.fontFamily,
    fontStyle: browserGeometry.fontStyle,
    weightCss: browserGeometry.weightCss,
  });

  // AUDIT: Log build-raster font construction
  console.info('[AUDIT:CLIENT:build-raster]', {
    previewFontString: browserGeometry.previewFontString,
    fontFamily: browserGeometry.fontFamily,
    weightCss: browserGeometry.weightCss,
    fontStyle: browserGeometry.fontStyle,
  });

  return browserGeometry;
}

// Save Preview function (SSOT workflow)
async function savePreview(buttonElement = null) {
  if (!window.auth?.currentUser) {
    alert('Please log in to save preview');
    return false;
  }

  const saveBtn = buttonElement || document.getElementById('save-preview-btn');
  const originalText = saveBtn ? saveBtn.textContent : 'Save Preview';

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  try {
    // Wait for fonts to be ready before measuring DOM
    await document.fonts.ready;

    // Actively load all DejaVu Sans variants
    const fontsReady = await ensureDejaVuVariantsReady(3000);
    if (!fontsReady) {
      // TTFs are fetched; don't hard-block the user
      // Continue with soft warning - parity is still very likely correct
      console.warn('[savePreview] Proceeding even though some faces did not confirm via check()');
    }

    // Get current caption meta from overlay system
    const meta = window.getCaptionMeta();

    if (!meta || !meta.text || !meta.text.trim()) {
      alert('Please add caption text first');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
      }
      return false;
    }

    // Find the correct elements for browser measurement
    const liveEl = document.getElementById('caption-live');
    const stageEl = document.querySelector('.caption-box') || liveEl?.parentElement;
    const overlayEl = document.querySelector('.caption-box .content');
    const contentEl = overlayEl || liveEl; // Prefer overlay, fallback to live
    const container = document.getElementById('live-preview-container');
    const previewCssW = container?.clientWidth || 360;

    if (!contentEl) {
      alert('Preview text element not found');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
      }
      return false;
    }

    // Diagnostic logging (temporary)
    console.log('[savePreview:element-debug]', {
      using: overlayEl ? '.caption-box .content' : '#caption-live',
      clientWidth: contentEl?.clientWidth,
      styleWidth: getComputedStyle(contentEl).width,
      padL: getComputedStyle(contentEl).paddingLeft,
      padR: getComputedStyle(contentEl).paddingRight,
      font: getComputedStyle(contentEl).font,
      textPreview: (contentEl?.innerText || '').slice(0, 60),
    });

    // Get browser-rendered geometry using shared line extraction
    const browserGeometry = buildRasterFromBrowser({
      stageEl,
      contentEl,
      frameW: 1080,
      frameH: 1920,
      previewCssW,
    });

    // Validate browser geometry
    if (browserGeometry.lines.length < 1) {
      alert('Unable to detect text lines - please try again');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
      }
      return false;
    }

    // SSOT-first: use window.__serverCaptionMeta if available
    const ssot = window.__serverCaptionMeta || {};
    const cs = liveEl ? getComputedStyle(liveEl) : null;
    const scale =
      typeof window.computePreviewScale === 'function' ? window.computePreviewScale() : 0.333;

    // Guard helper for numeric values
    const guardNum = (val, fallback) => (Number.isFinite(val) ? val : fallback);

    // Typography - fallbacks match server QMain defaults (SSOT)
    const fontFamily = ssot.fontFamily || meta.fontFamily || 'DejaVu Sans';
    const fontPx = guardNum(ssot.fontPx, guardNum(meta.fontPx, 64));
    const lineSpacingPx = guardNum(ssot.lineSpacingPx, guardNum(meta.lineSpacingPx, 8));
    const letterSpacingPx = guardNum(ssot.letterSpacingPx, 0);
    const weightCss = ssot.weightCss || meta.weightCss || 'normal';
    const fontStyle = ssot.fontStyle || 'normal';
    const textAlign = ssot.textAlign || meta.textAlign || 'center';
    const textTransform = ssot.textTransform || 'none';

    // Color & effects - fallbacks match server QMain defaults (SSOT)
    const color = ssot.color || meta.color || 'rgb(255,255,255)';
    const opacity = guardNum(ssot.opacity, guardNum(meta.opacity, 0.85));
    const strokePx = guardNum(ssot.strokePx, 3);
    const strokeColor = ssot.strokeColor || 'rgba(0,0,0,0.85)';
    const shadowColor = ssot.shadowColor || 'rgba(0,0,0,0.6)';
    const shadowBlur = guardNum(ssot.shadowBlur, 0);
    const shadowOffsetX = guardNum(ssot.shadowOffsetX, 1);
    const shadowOffsetY = guardNum(ssot.shadowOffsetY, 1);

    // Geometry
    const rasterW = guardNum(ssot.rasterW, 864);
    const rasterH = guardNum(ssot.rasterH, 200);
    const yPx_png = guardNum(ssot.yPx_png, 960);
    const rasterPadding = guardNum(ssot.rasterPadding, 24);
    const xExpr_png = ssot.xExpr_png || '(W-overlay_w)/2';

    // Get raw text from overlay input (source of truth for user edits)
    // Use currentQuote as source of truth instead of visual DOM element
    // This prevents innerText from corrupting text with missing spaces at line breaks
    const textRaw =
      currentQuote?.text?.trim() ||
      document.querySelector('#caption-input')?.value?.trim() ||
      liveEl?.textContent?.trim() || // textContent preserves text nodes better than innerText
      meta.text ||
      '';

    // Normalize for server and downstream features:
    // - Convert newlines to spaces
    // - Collapse multiple spaces into one
    // - Trim whitespace
    const text = textRaw
      .replace(/\s*\n\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const payload = {
      ssotVersion: 3,
      mode: 'raster',
      textRaw, // NEW: preserve original with newlines
      text, // normalized canonical version

      // Browser-rendered line data (REQUIRED)
      lines: browserGeometry.lines, // string[] - the actual line text (server derives count from lines.length)
      totalTextH: browserGeometry.totalTextH,
      yPxFirstLine: browserGeometry.yPxFirstLine,

      // Typography (from browser)
      fontFamily: browserGeometry.fontFamily,
      fontPx: browserGeometry.fontPx,
      lineSpacingPx: browserGeometry.lineSpacingPx,
      letterSpacingPx: browserGeometry.letterSpacingPx,
      weightCss: browserGeometry.weightCss,
      fontStyle: browserGeometry.fontStyle,
      previewFontString: browserGeometry.previewFontString,
      textAlign,
      textTransform,

      // Color & effects (from existing logic)
      color,
      opacity,
      strokePx,
      strokeColor,
      shadowColor,
      shadowBlur,
      shadowOffsetX,
      shadowOffsetY,

      // Geometry (from browser)
      rasterW: browserGeometry.rasterW,
      rasterH: browserGeometry.rasterH,
      rasterPadding: browserGeometry.rasterPadding,
      xPx_png: browserGeometry.xPx_png,
      yPx_png: browserGeometry.yPx_png,
      xExpr_png,

      // Client canonical values for server (required for V3 raster)
      clientRasterW: browserGeometry.rasterW,
      clientRasterH: browserGeometry.rasterH,
      clientRasterPadding: browserGeometry.rasterPadding,

      // Frame dimensions
      frameW: 1080,
      frameH: 1920,
    };

    // Derive V2 percentage fields from SSOT raster values for backward compatibility
    const frameW = 1080,
      frameH = 1920;
    payload.wPct = Number.isFinite(browserGeometry.rasterW)
      ? +(browserGeometry.rasterW / frameW).toFixed(6)
      : undefined;
    // Clamp yPct to [0, 1] range to prevent negative values
    const rawYPct = Number.isFinite(browserGeometry.yPx_png)
      ? +(browserGeometry.yPx_png / frameH).toFixed(6)
      : undefined;
    if (Number.isFinite(rawYPct)) {
      payload.yPct = Math.max(0, Math.min(1, rawYPct));
      if (rawYPct < 0 || rawYPct > 1) {
        console.warn('[savePreview] Clamped yPct from', rawYPct, 'to', payload.yPct);
      }
    } else {
      payload.yPct = undefined;
    }
    payload.xPct = Number.isFinite(payload.wPct) ? +((1 - payload.wPct) / 2).toFixed(6) : undefined;

    // Validate payload before POST
    const preNormalizationFields = [
      'totalTextH',
      'yPxFirstLine',
      'rasterW',
      'rasterH',
      'fontPx',
      'lineSpacingPx',
      'letterSpacingPx',
    ];
    const preInvalidFields = preNormalizationFields.filter(
      (field) => !Number.isFinite(payload[field])
    );

    if (preInvalidFields.length > 0) {
      throw new Error(`Invalid numeric fields: ${preInvalidFields.join(', ')}`);
    }

    if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
      throw new Error('lines must be a non-empty array');
    }

    console.log('[savePreview] Final payload (before normalization):', payload);

    // ✅ Normalize payload for server strict validation
    const normalizedPayload = normalizeRasterPayload(payload);

    // AUDIT: Log final payload before POST
    console.info('[AUDIT:CLIENT:final-payload]', {
      previewFontString: normalizedPayload.previewFontString,
      fontFamily: normalizedPayload.fontFamily,
      weightCss: normalizedPayload.weightCss,
      fontStyle: normalizedPayload.fontStyle,
      sample: (normalizedPayload.text ?? '').slice(0, 60),
    });

    // ✅ Comprehensive validation of normalized payload
    const numericFields = [
      'frameW',
      'frameH',
      'rasterW',
      'rasterH',
      'rasterPadding',
      'fontPx',
      'lineSpacingPx',
      'letterSpacingPx',
      'totalTextH',
      'yPxFirstLine',
      'xPx_png',
      'yPx_png',
    ];
    const invalidFields = numericFields.filter((field) => {
      const val = normalizedPayload[field];
      return !Number.isFinite(val) || !Number.isInteger(val);
    });

    if (invalidFields.length > 0) {
      console.error(
        '[savePreview:validation] Invalid numeric fields after normalization:',
        invalidFields
      );
      throw new Error(`Normalization failed for fields: ${invalidFields.join(', ')}`);
    }

    // Guard against negative or NaN yPx_png
    if (normalizedPayload.yPx_png < 0 || !Number.isFinite(normalizedPayload.yPx_png)) {
      console.error('[savePreview:validation] Invalid yPx_png:', normalizedPayload.yPx_png);
      throw new Error(`yPx_png must be >= 0, got: ${normalizedPayload.yPx_png}`);
    }

    // Validate string fields are present
    const stringFields = ['fontFamily', 'fontStyle', 'weightCss', 'previewFontString'];
    const missingStringFields = stringFields.filter(
      (field) => !normalizedPayload[field] || normalizedPayload[field].trim() === ''
    );

    if (missingStringFields.length > 0) {
      console.warn('[savePreview:validation] Missing string fields:', missingStringFields);
    }

    // Log normalized payload for debugging
    console.log('[savePreview:normalized]', {
      frameW: normalizedPayload.frameW,
      frameH: normalizedPayload.frameH,
      rasterW: normalizedPayload.rasterW,
      rasterH: normalizedPayload.rasterH,
      fontPx: normalizedPayload.fontPx,
      lineSpacingPx: normalizedPayload.lineSpacingPx,
      letterSpacingPx: normalizedPayload.letterSpacingPx,
      yPx_png: normalizedPayload.yPx_png,
      xPx_png: normalizedPayload.xPx_png,
      lines: normalizedPayload.lines?.length || 0,
      allIntegers: numericFields.every((field) => Number.isInteger(normalizedPayload[field])),
      allNonNegative: ['xPx_png'].every((field) => normalizedPayload[field] >= 0),
    });

    console.log('[savePreview:parity]', {
      hasSSOT: !!window.__serverCaptionMeta,
      fontPx: normalizedPayload.fontPx,
      lineSpacingPx: normalizedPayload.lineSpacingPx,
      letterSpacingPx: normalizedPayload.letterSpacingPx,
      rasterW: normalizedPayload.rasterW,
      rasterH: normalizedPayload.rasterH,
      yPx_png: normalizedPayload.yPx_png,
      rasterPadding: normalizedPayload.rasterPadding,
      lines: normalizedPayload.lines?.length || 0,
      linesCount: normalizedPayload.lines?.length,
      allNumsFinite: Object.entries(normalizedPayload)
        .filter(([k, v]) => typeof v === 'number')
        .every(([k, v]) => Number.isFinite(v)),
    });

    // Preflight validation to catch MISSING_SPLITLINES early
    console.log('[preflight]', {
      hasLinesArray: Array.isArray(normalizedPayload.lines),
      linesLen: normalizedPayload.lines?.length,
    });

    // Diagnostic logging of final payload before POST
    console.log('[savePreview:final]', {
      keys: Object.keys(normalizedPayload),
      textLen: normalizedPayload.text?.length,
      textRawLen: normalizedPayload.textRaw?.length,
      sample: normalizedPayload.text?.slice(0, 80),
      hasText: !!normalizedPayload.text,
      hasTextRaw: !!normalizedPayload.textRaw,
      linesCount: normalizedPayload.lines?.length || 0,
    });

    // Call preview API with normalized payload
    const { apiFetch } = await import('/api.mjs');
    const data = await apiFetch('/caption/preview', {
      method: 'POST',
      body: normalizedPayload,
    });

    if (!data?.ok) {
      throw new Error(data?.detail || data?.reason || 'Preview generation failed');
    }

    console.log('[savePreview] Preview saved successfully:', data.data.meta);

    // CRITICAL: Read from correct locations
    const resp = data?.data || {};
    const m = resp.meta || {};

    // Accept both field names from server (coerce to numbers)
    const totalTextH = Number(m.totalTextH ?? m.totalTextHPx);
    const serverLineSpacingPx = Number(m.lineSpacingPx ?? 0);
    const linesCount = m.lines?.length || 0;

    // Server-authoritative geometry - overwrite client values
    const serverRasterW = Number.isFinite(m.rasterW) ? m.rasterW : rasterW;
    const serverRasterH = Number.isFinite(m.rasterH) ? m.rasterH : 200;
    const serverRasterPadding = Number.isFinite(m.rasterPadding) ? m.rasterPadding : rasterPadding;
    let serverYPxPng = Number.isFinite(m.yPx_png) ? m.yPx_png : null;
    const serverXExprPng = m.xExpr_png || xExpr_png;
    const serverPreviewFontString = m.previewFontString || '';
    const serverPreviewFontHash = m.previewFontHash || '';

    // If server omits yPx_png, compute via toRasterYPx helper
    if (!Number.isFinite(serverYPxPng)) {
      const frameH = m.frameH || 1920;
      const placement = m.placement || 'center';
      const yPct = m.yPct || 0.5;
      serverYPxPng = toRasterYPx({
        frameH,
        rasterH: serverRasterH,
        placement,
        yPct,
        internalPaddingPx: serverRasterPadding,
      });
      console.log('[savePreview] Computed yPx_png from placement:', {
        placement,
        yPct,
        serverYPxPng,
      });
    }

    // Compute yPxFirstLine from yPx_png + rasterPadding (server no longer returns top-level yPx)
    const yPxFirstLine =
      Number.isFinite(serverYPxPng) && Number.isFinite(serverRasterPadding)
        ? serverYPxPng + serverRasterPadding
        : NaN;

    // Verify we got real values before saving
    console.log('[savePreview] SSOT fields extracted:', {
      totalTextH,
      yPxFirstLine,
      lineSpacingPx,
      lines: linesCount,
      serverRasterW,
      serverRasterH,
      serverYPxPng,
      serverRasterPadding,
      source: {
        'data.yPx': resp.yPx,
        'meta.totalTextH': m.totalTextH,
        'meta.totalTextHPx': m.totalTextHPx,
        'meta.lines': m.lines?.length,
      },
    });

    const normalizedMeta = {
      ssotVersion: 3,
      mode: 'raster',

      // Pass through ALL server SSOT fields verbatim
      text: m.text || meta.text,

      // Geometry lock (render frame dimensions)
      frameW: m.frameW,
      frameH: m.frameH,
      bgScaleExpr: m.bgScaleExpr,
      bgCropExpr: m.bgCropExpr,

      // PNG raster data - use server-authoritative values
      rasterUrl: m.rasterUrl,
      rasterW: serverRasterW,
      rasterH: serverRasterH,
      rasterPadding: serverRasterPadding, // CRITICAL

      // PNG placement (absolute coordinates) - use server-authoritative values
      xExpr_png: serverXExprPng,
      yPx_png: serverYPxPng, // Server-computed or computed via helper

      // Verification hashes - use server values
      rasterHash: m.rasterHash,
      previewFontString: serverPreviewFontString,
      previewFontHash: serverPreviewFontHash,

      // Typography (informational only for v3 raster)
      fontPx: Number(m.fontPx || meta.fontPx || 48),
      fontFamily: m.fontFamily || meta.fontFamily || 'DejaVu Sans',
      weightCss: m.weightCss || meta.weightCss || 'normal',
      fontStyle: m.fontStyle || 'normal',
      textAlign: m.textAlign || 'center',
      letterSpacingPx: Number(m.letterSpacingPx ?? 0),
      textTransform: m.textTransform || 'none',

      // Color & effects (informational)
      color: m.color || meta.color || '#ffffff',
      opacity: Number(m.opacity ?? meta.opacity ?? 1.0),
      strokePx: Number(m.strokePx ?? 0),
      strokeColor: m.strokeColor || 'rgba(0,0,0,0.85)',
      shadowColor: m.shadowColor || 'rgba(0,0,0,0.6)',
      shadowBlur: Number(m.shadowBlur ?? 12),
      shadowOffsetX: Number(m.shadowOffsetX ?? 0),
      shadowOffsetY: Number(m.shadowOffsetY ?? 2),

      // Layout (informational)
      placement: m.placement || 'custom',
      internalPadding: Number(m.internalPadding ?? 32),

      // Diagnostics (keep for debugging, NOT used in render)
      lineSpacingPx: serverLineSpacingPx,
      lines: Array.isArray(m.lines) ? m.lines : [],
      totalTextH: Number(m.totalTextH ?? 0),

      // Legacy compatibility fields (deprecated for v3 raster)
      totalTextHPx: totalTextH,
      yPxFirstLine: yPxFirstLine,
      xPct: Number(m.xPct ?? meta.xPct ?? 0.5),
      // PRIMARY FIX: Clamp yPct to [0, 1] range to prevent negative values
      yPct: (() => {
        const rawYPct = Number(m.yPct ?? meta.yPct ?? 0.5);
        const clamped = Math.max(0, Math.min(1, rawYPct));
        if (rawYPct < 0 || rawYPct > 1) {
          console.warn('[savePreview] Clamped normalizedMeta.yPct from', rawYPct, 'to', clamped);
        }
        return clamped;
      })(),
      wPct: Number(m.wPct ?? meta.wPct ?? 0.8),

      // Additional raster aliases for compatibility
      rasterDataUrl: m.rasterUrl,
      rasterPng: m.rasterUrl,
      xExpr: m.xExpr_png || '(W-overlay_w)/2',
    };

    // V3 raster mode validation - ensure all required fields are present
    if (normalizedMeta.mode === 'raster') {
      const requiredRasterFields = [
        'rasterUrl',
        'rasterW',
        'rasterH',
        'yPx_png',
        'rasterPadding',
        'frameW',
        'frameH',
        'bgScaleExpr',
        'bgCropExpr',
        'rasterHash',
        'previewFontString',
      ];

      const missingFields = requiredRasterFields.filter((f) => normalizedMeta[f] == null);

      if (missingFields.length > 0) {
        console.error('[savePreview-ERROR] Missing raster fields:', missingFields);
        throw new Error(
          `Server returned incomplete raster metadata. Missing: ${missingFields.join(', ')}`
        );
      }

      console.log('[savePreview-v3] ✅ All raster fields present (server-authoritative):', {
        yPx_png: normalizedMeta.yPx_png,
        rasterW: normalizedMeta.rasterW,
        rasterH: normalizedMeta.rasterH,
        rasterPadding: normalizedMeta.rasterPadding,
        frameW: normalizedMeta.frameW,
        frameH: normalizedMeta.frameH,
        rasterHash: normalizedMeta.rasterHash?.slice(0, 8) + '...',
        xExpr_png: normalizedMeta.xExpr_png,
        previewFontString: normalizedMeta.previewFontString?.slice(0, 20) + '...',
      });
    }

    // Client-side guard: warn if raster dimensions look like full canvas
    if (
      normalizedMeta.mode === 'raster' &&
      normalizedMeta.rasterW === 1080 &&
      normalizedMeta.rasterH === 1920
    ) {
      console.warn(
        '[client-guard] Raster size looks like full canvas. Preview meta not wired correctly.'
      );
    }

    // Store normalized overlay meta for render (SSOT)
    window._overlayMeta = normalizedMeta;
    window.lastCaptionPNG = {
      dataUrl: data.data?.imageUrl,
      width: data.data?.wPx || 1080,
      height: data.data?.hPx || 1920,
      meta: normalizedMeta,
    };
    window.__lastCaptionOverlay = window.lastCaptionPNG;

    // Persist to localStorage for "Save Preview" workflow (V3 storage key)
    try {
      localStorage.setItem('overlayMetaV3', JSON.stringify(normalizedMeta));
      console.log('[v3:savePreview] saved', {
        v: normalizedMeta.ssotVersion,
        mode: normalizedMeta.mode,
        keys: Object.keys(normalizedMeta),
        hasRaster: !!normalizedMeta.rasterUrl || !!normalizedMeta.rasterDataUrl,
      });
    } catch (err) {
      console.warn('[savePreview] Failed to save to localStorage:', err.message);
    }

    // Set flag indicating preview is saved for current text
    window._previewSavedForCurrentText = true;
    console.log('[preview-state] Preview saved successfully for current caption text');

    // Mark preview as saved in overlay system (clears geometry dirty, enables raster mode)
    try {
      const { markPreviewSaved } = await import('/js/caption-overlay.js');
      markPreviewSaved();
      console.log('[preview-state] Preview saved successfully, switching to raster mode');
    } catch (err) {
      console.warn('[preview-state] Failed to mark preview as saved:', err);
    }

    // Apply saved server meta to live preview immediately
    if (typeof window.updateCaptionState === 'function' && normalizedMeta) {
      // CRITICAL: Set server SSOT first
      window.__serverCaptionMeta = normalizedMeta;

      const liveEl = document.getElementById('caption-live');
      if (liveEl) {
        // Build COMPLETE SSOT v3 raster state from normalizedMeta
        const currentState = {
          // Identity - use textRaw to preserve user's intended wraps
          text: normalizedMeta.textRaw || normalizedMeta.text || '',

          // CRITICAL: Tell live layer to use raster branch
          mode: normalizedMeta.mode || 'raster',

          // Geometry (raster) - ensure finite numbers
          rasterW: Number.isFinite(normalizedMeta.rasterW) ? normalizedMeta.rasterW : 1080,
          rasterH: Number.isFinite(normalizedMeta.rasterH) ? normalizedMeta.rasterH : 200,
          rasterPadding: Number.isFinite(normalizedMeta.rasterPadding)
            ? normalizedMeta.rasterPadding
            : 24,
          yPx_png: Number.isFinite(normalizedMeta.yPx_png) ? normalizedMeta.yPx_png : 24,
          xExpr_png: normalizedMeta.xExpr_png || '(W-overlay_w)/2',

          // Typography - ensure finite numbers with safe defaults
          fontFamily: normalizedMeta.fontFamily || 'DejaVu Sans',
          fontPx: Number.isFinite(normalizedMeta.fontPx) ? normalizedMeta.fontPx : 48,
          lineSpacingPx: Number.isFinite(normalizedMeta.lineSpacingPx)
            ? normalizedMeta.lineSpacingPx
            : 8,
          letterSpacingPx: Number.isFinite(normalizedMeta.letterSpacingPx)
            ? normalizedMeta.letterSpacingPx
            : 0,
          weightCss: normalizedMeta.weightCss || 'bold',
          fontStyle: normalizedMeta.fontStyle || 'normal',
          textAlign: normalizedMeta.textAlign || 'center',
          textTransform: normalizedMeta.textTransform || 'none',

          // Colors & effects - ensure finite numbers with safe defaults
          color: normalizedMeta.color || '#ffffff',
          opacity: Number.isFinite(normalizedMeta.opacity) ? normalizedMeta.opacity : 1.0,
          strokePx: Number.isFinite(normalizedMeta.strokePx) ? normalizedMeta.strokePx : 0,
          strokeColor: normalizedMeta.strokeColor || 'rgba(0,0,0,0.85)',
          shadowColor: normalizedMeta.shadowColor || 'rgba(0,0,0,0.6)',
          shadowBlur: Number.isFinite(normalizedMeta.shadowBlur) ? normalizedMeta.shadowBlur : 12,
          shadowOffsetX: Number.isFinite(normalizedMeta.shadowOffsetX)
            ? normalizedMeta.shadowOffsetX
            : 0,
          shadowOffsetY: Number.isFinite(normalizedMeta.shadowOffsetY)
            ? normalizedMeta.shadowOffsetY
            : 2,

          // SSOT metadata
          ssotVersion: normalizedMeta.ssotVersion || 3,

          // Legacy compatibility fields (informational only)
          xPct: normalizedMeta.xPct || 0.5,
          yPct: normalizedMeta.yPct || 0.5,
          wPct: normalizedMeta.wPct || 0.8,
        };

        window.updateCaptionState(currentState);
        console.log('[savePreview] Applied complete SSOT v3 raster state to live preview');
      }
    }

    // Debug: Log what was saved
    console.log('[savePreview] Saved meta details:', {
      mode: normalizedMeta.mode,
      ssotVersion: normalizedMeta.ssotVersion,
      text: normalizedMeta.text,
      textLength: normalizedMeta.text?.length,
      // Raster specifics
      yPx_png: normalizedMeta.yPx_png,
      rasterW: normalizedMeta.rasterW,
      rasterH: normalizedMeta.rasterH,
      rasterPadding: normalizedMeta.rasterPadding,
      frameW: normalizedMeta.frameW,
      frameH: normalizedMeta.frameH,
      hasRasterUrl: !!normalizedMeta.rasterUrl,
      rasterHash: normalizedMeta.rasterHash?.slice(0, 8) + '...',
    });

    // Sanity log: Show text diff snippet to catch regressions
    const normalizeForLog = (text) =>
      (text || '')
        .replace(/\s*\n\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const savedNormalized = normalizeForLog(normalizedMeta.textRaw || normalizedMeta.text);
    const currentNormalized = normalizeForLog(currentQuote?.text || liveEl?.textContent);
    console.log('[savePreview:sanity] Text diff snippet:', {
      savedRaw: (normalizedMeta.textRaw || '').substring(0, 50),
      savedNormalized: savedNormalized.substring(0, 50),
      currentNormalized: currentNormalized.substring(0, 50),
      equality: savedNormalized === currentNormalized,
    });

    // Debug: Verify functions are available
    console.log('[savePreview] Function availability after save:', {
      getSavedOverlayMeta: !!window.getSavedOverlayMeta,
      getCaptionMeta: !!window.getCaptionMeta,
      previewSavedFlag: window._previewSavedForCurrentText,
    });

    // --- OPTIONAL overlay / debug work below. Must never block a successful save. ---

    // Hide Save Preview button and show success indicator
    if (saveBtn) {
      saveBtn.style.display = 'none';
    }

    // Show success indicator
    if (typeof window.showPreviewSavedIndicator === 'function') {
      window.showPreviewSavedIndicator('#preview-status');
    } else {
      // Fallback: directly update the preview status container
      const container = document.querySelector('#preview-status');
      if (container) {
        container.innerHTML = `
                            <div class="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded text-sm">
                                <span>✓</span>
                                <span>Preview saved - ready to render</span>
                            </div>
                        `;
        container.classList.remove('hidden');
      }
      console.warn('[savePreview] showPreviewSavedIndicator not available, using fallback');
    }

    // Enable render button (after localStorage save is complete)
    updateRenderButtonState();

    // ✅ NEW: Show server PNG for WYSIWYG guarantee
    if (normalizedMeta?.rasterUrl) {
      try {
        const { showServerPNG } = await import('/js/caption-live.js');
        showServerPNG(normalizedMeta.rasterUrl, normalizedMeta);
        console.log('[savePreview] Swapped to server PNG for WYSIWYG');
      } catch (error) {
        console.warn('[savePreview] Failed to swap to PNG:', error);
      }
    }

    // Preview saved successfully
    return true;
  } catch (error) {
    console.error('[savePreview] Error:', error);
    const msg = error?.message || String(error || '');
    const isStyleNull = msg.includes("Cannot read properties of null (reading 'style')");

    const metaAvailable = (() => {
      try {
        return typeof window.getSavedOverlayMeta === 'function' && !!window.getSavedOverlayMeta();
      } catch (_) {
        return false;
      }
    })();

    if (isStyleNull && metaAvailable) {
      console.warn('[savePreview][nonfatal] style=null after successful save, ignoring.', { msg });
      return true;
    }

    alert(`Save preview failed: ${msg}`);
    return false;
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = originalText;
    }
  }
}

// Combined Create function (Save Preview + Render)
async function createShort() {
  const renderBtn = document.getElementById('render-btn');
  const mobileCreateBtn = document.getElementById('mobile-create-btn');
  if (!renderBtn && !mobileCreateBtn) return;

  const originalText = renderBtn?.textContent || mobileCreateBtn?.textContent || 'Create';

  try {
    // Step 1: Save Preview
    if (renderBtn) {
      renderBtn.disabled = true;
      renderBtn.textContent = 'Saving preview...';
    }
    if (mobileCreateBtn) {
      mobileCreateBtn.disabled = true;
      mobileCreateBtn.textContent = 'Saving preview...';
    }

    const previewSaved = await savePreview(renderBtn || mobileCreateBtn);
    if (!previewSaved) {
      // Error already shown by savePreview
      if (renderBtn) {
        renderBtn.disabled = false;
        renderBtn.textContent = originalText;
      }
      if (mobileCreateBtn) {
        mobileCreateBtn.disabled = false;
        mobileCreateBtn.textContent = originalText;
      }
      return;
    }

    // Step 2: Render (renderShort will handle its own button state)
    await renderShort();
  } catch (error) {
    console.error('[createShort] Error:', error);
    alert(`Failed to create short: ${error.message}`);
    if (renderBtn) {
      renderBtn.disabled = false;
      renderBtn.textContent = originalText;
    }
    if (mobileCreateBtn) {
      mobileCreateBtn.disabled = false;
      mobileCreateBtn.textContent = originalText;
    }
  }
}

// Render short function
async function renderShort() {
  // [STUDIO] Block legacy render if studio is disabled
  if (!ENABLE_LEGACY_STUDIO) {
    alert('Legacy quote studio is disabled. Please use the Article Explainer feature instead.');
    return;
  }

  // Require at least one feature (quote, asset, or voiceover)
  if (!currentQuote && !selectedAsset && !currentVoiceId) {
    alert('Please add a quote, select media, or choose a voiceover first');
    return;
  }

  if (!window.auth?.currentUser) {
    alert('Please log in to render shorts');
    return;
  }

  const renderBtn = document.getElementById('render-btn');
  const mobileCreateBtn = document.getElementById('mobile-create-btn');
  const originalText = renderBtn?.textContent || mobileCreateBtn?.textContent || 'Create';

  if (renderBtn) {
    renderBtn.disabled = true;
    renderBtn.textContent = 'Rendering...';
  }
  if (mobileCreateBtn) {
    mobileCreateBtn.disabled = true;
    mobileCreateBtn.textContent = 'Rendering...';
  }

  try {
    const { apiFetch } = await import('/api.mjs');

    // Prepare the render payload with proper background structure (optional)
    let background = null;

    if (selectedAsset) {
      const assetUrl = selectedAsset.fileUrl || selectedAsset.url;

      // Detect type from URL extension
      const detectTypeFromUrl = (url) => {
        if (!url) return 'image'; // Default fallback

        try {
          // Handle URLs with query parameters or fragments
          const cleanUrl = url.split('?')[0].split('#')[0];
          const ext = cleanUrl.toLowerCase().split('.').pop();

          console.log(`[typeDetection] URL: ${url}`);
          console.log(`[typeDetection] Clean URL: ${cleanUrl}`);
          console.log(`[typeDetection] Extension: ${ext}`);

          if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', '3gp', 'flv'].includes(ext)) {
            return 'video';
          }
          if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'tiff'].includes(ext)) {
            return 'image';
          }

          // Default fallback
          console.log(`[typeDetection] Unknown extension: ${ext}, defaulting to image`);
          return 'image';
        } catch (error) {
          console.error(`[typeDetection] Error parsing URL: ${error.message}`);
          return 'image'; // Safe fallback
        }
      };

      const detectedType = detectTypeFromUrl(assetUrl);

      console.log(`[render] Asset URL: ${assetUrl}`);
      console.log(`[render] Detected type: ${detectedType}`);

      background = {
        kind:
          selectedAsset.provider === 'ai'
            ? 'ai'
            : selectedAsset.provider === 'uploaded'
              ? 'upload'
              : 'stock',
        type: detectedType, // Use detected type from URL
        url: assetUrl, // Required URL
        query: selectedAsset.query,
        // Legacy fields for backward compatibility
        imageUrl: selectedAsset.provider === 'uploaded' ? selectedAsset.fileUrl : undefined,
        prompt: selectedAsset.provider === 'ai' ? selectedAsset.query : undefined,
      };
    } else {
      console.log('[render] No asset selected - will render with black background');
    }

    // Get caption style settings
    const captionStyle = {
      font: document.getElementById('caption-font').value,
      weight: document.getElementById('caption-weight').value,
      sizePx: window.getCaptionPx(),
      opacity: parseInt(document.getElementById('caption-opacity').value) / 100,
      placement: document.getElementById('caption-placement').value,
      showBox: document.getElementById('caption-background').checked,
      boxOpacity: parseInt(document.getElementById('caption-bg-opacity').value) / 100,
    };

    // --- BEGIN strictly-typed payload construction ---

    // 1) Get current quote text safely as a string
    const quoteText = ((currentQuote && currentQuote.text) || '').toString();

    // 2) Get mapped and clamped font size
    const sizePx = window.getCaptionPx();

    // 3) Find last generated overlay from preview step
    //    (caption-preview.js should already be writing this)
    const overlay = window.__lastCaptionOverlay;
    // overlay shape we expect: { dataUrl: 'data:image/png;base64,...', width, height, meta: {...} }
    const overlayDataUrl =
      overlay && typeof overlay.dataUrl === 'string' ? overlay.dataUrl : undefined;

    // 4) Voice handling (don't change existing selection logic—just make sure we send strings)
    const voiceId = (currentVoiceId || '').toString();
    const wantVoiceover = !!currentVoiceId; // keep existing toggle, but normalize to boolean

    // 5) Background (use what the page already computed)
    const bg = background; // must be whatever your UI already sets up

    // 6) Build payload with correct conditional logic
    let payload = {
      mode: 'quote',
      template: 'calm',
      durationSec: 8,
      voiceover: wantVoiceover,
      includeBottomCaption: true,
      wantAttribution: true,
      watermark: true,

      // strings only
      text: quoteText,
      ttsText: wantVoiceover ? quoteText : '',

      // keep existing background contract
      background: bg,

      // pass voice id only if voiceover is on (string type)
      voiceId: wantVoiceover && voiceId ? voiceId : undefined,

      // TTS settings for SSOT (normalized to 0-1 range)
      modelId: wantVoiceover ? 'eleven_multilingual_v2' : undefined,
      outputFormat: wantVoiceover ? 'mp3_44100_128' : undefined,
      voiceSettings: wantVoiceover
        ? {
            stability: parseFloat(document.getElementById('tts-stability').value),
            similarity_boost: parseFloat(document.getElementById('tts-similarity').value),
            style: Math.max(
              0,
              Math.min(1, parseInt(document.getElementById('tts-style').value) / 100)
            ), // Normalize 0-100 to 0-1
            use_speaker_boost: document.getElementById('tts-speaker-boost').checked,
          }
        : undefined,
    };

    // SSOT: Use saved overlay meta from preview
    if (useOverlayMode && overlaySystemInitialized) {
      // Validate saved preview before rendering
      const validation = window.validateBeforeRender
        ? window.validateBeforeRender()
        : { valid: false, errors: ['Preview not saved'] };

      if (!validation.valid) {
        alert(`Cannot render: ${validation.errors.join(', ')}`);
        if (renderBtn) {
          renderBtn.disabled = false;
          renderBtn.textContent = originalText;
        }
        if (mobileCreateBtn) {
          mobileCreateBtn.disabled = false;
          mobileCreateBtn.textContent = originalText;
        }
        return;
      }

      let savedMeta = validation.meta;

      // Validate ssotVersion and mode for v3 raster
      const isRaster = savedMeta?.mode === 'raster';
      if (savedMeta?.ssotVersion !== 3) {
        console.error(
          '[render-ERROR] Invalid ssotVersion, expected 3, got:',
          savedMeta?.ssotVersion
        );
        alert('Preview data is outdated (wrong version). Please Save Preview again (v3).');
        if (renderBtn) {
          renderBtn.disabled = false;
          renderBtn.textContent = originalText;
        }
        if (mobileCreateBtn) {
          mobileCreateBtn.disabled = false;
          mobileCreateBtn.textContent = originalText;
        }
        return;
      }

      // V3 raster mode requires raster fields
      if (isRaster && !savedMeta?.rasterUrl && !savedMeta?.rasterDataUrl) {
        console.error('[render-ERROR] Raster mode requires rasterUrl, got:', savedMeta);
        alert('Raster preview incomplete. Please Save Preview again (v3).');
        if (renderBtn) {
          renderBtn.disabled = false;
          renderBtn.textContent = originalText;
        }
        if (mobileCreateBtn) {
          mobileCreateBtn.disabled = false;
          mobileCreateBtn.textContent = originalText;
        }
        return;
      }

      console.log('[v3:client:POST]', {
        ssotVersion: savedMeta.ssotVersion,
        mode: savedMeta.mode,
        hasRaster: !!savedMeta.rasterPng || !!savedMeta.rasterDataUrl || !!savedMeta.rasterUrl,
      });

      // SSOT: Server is single source of truth - no client corrections
      // Use saved meta exactly as provided by server

      // Server validates metrics properly - no need for overly restrictive client bounds
      // Only check for clearly invalid values (NaN, negative, etc.)
      if (!Number.isFinite(savedMeta.totalTextH) || savedMeta.totalTextH <= 0) {
        console.error('[render-ERROR] Invalid totalTextH:', savedMeta.totalTextH);
        alert('Preview data has invalid metrics. Please regenerate preview.');
        if (renderBtn) {
          renderBtn.disabled = false;
          renderBtn.textContent = originalText;
        }
        if (mobileCreateBtn) {
          mobileCreateBtn.disabled = false;
          mobileCreateBtn.textContent = originalText;
        }
        return;
      }

      // CRITICAL: Verify we're sending real numeric values, not undefined
      console.log('[render-CRITICAL] overlayCaption being sent:', {
        keys: Object.keys(savedMeta || {}),
        totalTextH: savedMeta?.totalTextH,
        totalTextHPx: savedMeta?.totalTextHPx,
        yPxFirstLine: savedMeta?.yPxFirstLine,
        lineSpacingPx: savedMeta?.lineSpacingPx,
        lines: Array.isArray(savedMeta?.lines) ? savedMeta.lines.length : 0,
      });

      // Guard: fail fast if critical SSOT fields are missing/invalid
      if (!Number.isFinite(savedMeta?.totalTextH)) {
        alert(
          'Preview data incomplete (totalTextH missing). Please generate and save preview again.'
        );
        if (renderBtn) {
          renderBtn.disabled = false;
          renderBtn.textContent = originalText;
        }
        if (mobileCreateBtn) {
          mobileCreateBtn.disabled = false;
          mobileCreateBtn.textContent = originalText;
        }
        throw new Error('Missing SSOT field: totalTextH');
      }

      if (!Number.isFinite(savedMeta?.yPxFirstLine)) {
        alert(
          'Preview data incomplete (yPxFirstLine missing). Please generate and save preview again.'
        );
        if (renderBtn) {
          renderBtn.disabled = false;
          renderBtn.textContent = originalText;
        }
        if (mobileCreateBtn) {
          mobileCreateBtn.disabled = false;
          mobileCreateBtn.textContent = originalText;
        }
        throw new Error('Missing SSOT field: yPxFirstLine');
      }

      if (!Array.isArray(savedMeta?.lines) || savedMeta.lines.length === 0) {
        alert('Preview data incomplete (lines missing). Please generate and save preview again.');
        if (renderBtn) {
          renderBtn.disabled = false;
          renderBtn.textContent = originalText;
        }
        if (mobileCreateBtn) {
          mobileCreateBtn.disabled = false;
          mobileCreateBtn.textContent = originalText;
        }
        throw new Error('Missing SSOT field: lines');
      }

      // Tiny safety net: Clamp yPct to [0, 1] if somehow still negative (defensive programming)
      if (Number.isFinite(savedMeta.yPct) && (savedMeta.yPct < 0 || savedMeta.yPct > 1)) {
        const clamped = Math.max(0, Math.min(1, savedMeta.yPct));
        console.warn(
          '[render] Safety net: Clamped savedMeta.yPct from',
          savedMeta.yPct,
          'to',
          clamped
        );
        savedMeta.yPct = clamped;
      }

      payload.captionMode = 'overlay';
      payload.overlayCaption = savedMeta; // Use saved meta directly (already normalized by server)

      // CRITICAL: Use the text from saved preview to ensure exact match
      payload.text = savedMeta.text || quoteText;
      payload.ttsText = wantVoiceover ? savedMeta.text || quoteText : '';

      // Verify text matching
      console.log('[render-text-match] Using saved preview text:', {
        savedText: savedMeta.text,
        currentText: quoteText,
        textMatch: savedMeta.text === quoteText,
        finalPayloadText: payload.text,
      });

      // SSOT checkpoint before POST
      console.log('[ssot/v2:client:POST]', {
        ssotVersion: savedMeta.ssotVersion,
        fontPx: savedMeta.fontPx,
        lineSpacingPx: savedMeta.lineSpacingPx,
        totalTextH: savedMeta.totalTextH,
        yPxFirstLine: savedMeta.yPxFirstLine,
        lines: savedMeta.lines?.length,
        formula: `${savedMeta.lines?.length}*${savedMeta.fontPx} + ${savedMeta.lines?.length - 1}*${savedMeta.lineSpacingPx} = ${savedMeta.totalTextH}`,
      });

      // SSOT v2 logging
      console.log('[render] outgoing overlayCaption:', {
        ssotVersion: savedMeta.ssotVersion,
        keys: Object.keys(savedMeta),
      });

      console.log('[render] Using saved preview meta:', {
        xPct: savedMeta.xPct,
        yPct: savedMeta.yPct,
        fontPx: savedMeta.fontPx,
        totalTextH: savedMeta.totalTextH,
      });

      // Remove legacy fields when using overlay
      delete payload.caption;
      delete payload.captionStyle;
      delete payload.captionImage;
    } else if (overlayDataUrl) {
      // Legacy PNG overlay fallback
      payload.captionImage = overlayDataUrl;
      delete payload.caption;
      delete payload.captionStyle;
    } else {
      // Legacy drawtext fallback
      payload.caption = sizePx;
      payload.captionMode = 'static';
      payload.captionStyle = {
        placement: captionStyle.placement || 'bottom',
        align: 'center',
        opacity: clamp(captionStyle.opacity || 0.8, 0, 1),
        weight: captionStyle.weight || 'bold',
        font: captionStyle.font || 'DejaVu Sans Local',
      };
    }

    // remove undefined keys so contract stays clean
    payload = stripUndefined(payload);

    // 7) Log minimal, type-focused debug
    console.debug('[render] payload.types', {
      captionMode: payload.captionMode, // 'overlay' | 'static' | undefined
      overlayCaption: !!payload.overlayCaption, // boolean for debugging
      caption_type: typeof payload.caption, // expect 'number' when no overlay, 'undefined' when overlay
      captionImage_type: typeof payload.captionImage, // 'string' when overlay present or 'undefined'
      text_type: typeof payload.text, // 'string'
      ttsText_type: typeof payload.ttsText, // 'string'
      voiceId_type: typeof payload.voiceId, // 'string' or 'undefined'
      hasOverlay: !!overlayDataUrl, // boolean for debugging
      caption_value: payload.caption, // show actual value
      mappedSizePx: sizePx, // show mapped font size
    });

    // --- END strictly-typed payload construction ---

    // CRITICAL: Verify overlayCaption payload before sending
    if (payload.overlayCaption) {
      console.log(
        '[render-CRITICAL] overlayCaption keys being sent:',
        Object.keys(payload.overlayCaption)
      );
      console.log('[render-CRITICAL] overlayCaption sample:', {
        yPxFirstLine: payload.overlayCaption?.yPxFirstLine,
        totalTextHPx: payload.overlayCaption?.totalTextHPx,
        totalTextH: payload.overlayCaption?.totalTextH,
        lineSpacingPx: payload.overlayCaption?.lineSpacingPx,
        lines: payload.overlayCaption?.lines?.length,
        fontPx: payload.overlayCaption?.fontPx,
        xPct: payload.overlayCaption?.xPct,
        yPct: payload.overlayCaption?.yPct,
        wPct: payload.overlayCaption?.wPct,
        internalPadding: payload.overlayCaption?.internalPadding,
      });

      // SSOT invariant validation before render
      const { fontPx, lineSpacingPx, totalTextH, lines } = payload.overlayCaption;
      if (
        Number.isFinite(fontPx) &&
        Number.isFinite(lineSpacingPx) &&
        Number.isFinite(totalTextH) &&
        Array.isArray(lines) &&
        lines.length > 0
      ) {
        const expectedTotalTextH = lines.length * fontPx + (lines.length - 1) * lineSpacingPx;
        if (Math.abs(totalTextH - expectedTotalTextH) > 0.5) {
          console.error(
            '[render-INVARIANT] Client totalTextH mismatch - forcing preview regeneration:',
            {
              actual: totalTextH,
              expected: expectedTotalTextH,
              formula: `${lines.length}*${fontPx} + ${lines.length - 1}*${lineSpacingPx}`,
              lines: lines.length,
              fontPx,
              lineSpacingPx,
            }
          );
          throw new Error(
            `SSOT invariant violation: totalTextH=${totalTextH} != expected=${expectedTotalTextH}. Please regenerate preview.`
          );
        }
        console.log('[render-INVARIANT] ✅ Client totalTextH validation passed:', {
          totalTextH,
          expectedTotalTextH,
        });
      }
    }

    console.log('[render] Final payload:', payload);

    // AUDIT: Log render POST payload
    if (payload.overlayCaption) {
      console.info('[AUDIT:CLIENT:render-post]', {
        ssotVersion: payload.overlayCaption.ssotVersion,
        previewFontString: payload.overlayCaption.previewFontString,
        fontFamily: payload.overlayCaption.fontFamily,
        previewFontHash: payload.overlayCaption.previewFontHash,
      });
    }

    // SSOT validation: Log overlay caption meta to verify positioning data
    if (payload.overlayCaption) {
      const textPreview = payload.overlayCaption.text || '';
      const hasNewlines = textPreview.includes('\n');
      const lineCount = hasNewlines ? textPreview.split('\n').length : 1;

      console.log('[render] overlayCaption contract verification:', {
        yPct: payload.overlayCaption.yPct,
        totalTextH: payload.overlayCaption.totalTextH,
        lineSpacingPx: payload.overlayCaption.lineSpacingPx,
        fontPx: payload.overlayCaption.fontPx,
        wPct: payload.overlayCaption.wPct,
        xPct: payload.overlayCaption.xPct,
        textLength: textPreview.length,
        hasNewlines: hasNewlines,
        lineCount: lineCount,
        textPreview: textPreview.substring(0, 80) + (textPreview.length > 80 ? '...' : ''),
        color: payload.overlayCaption.color,
        opacity: payload.overlayCaption.opacity,
      });
    }
    console.log('[render] Background object:', background);
    console.log('[render] Current voice ID:', currentVoiceId);

    // Final validation before sending
    if (background.url && background.type) {
      const url = background.url.toLowerCase();
      const isVideoUrl = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'].some((ext) =>
        url.includes(`.${ext}`)
      );
      const isImageUrl = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].some((ext) =>
        url.includes(`.${ext}`)
      );

      if (background.type === 'video' && !isVideoUrl) {
        console.error('[validation] Type mismatch: type is video but URL is not a video');
        alert(
          'Error: Selected asset type does not match URL. Please try selecting a different asset.'
        );
        return;
      }
      if (background.type === 'image' && !isImageUrl) {
        console.error('[validation] Type mismatch: type is image but URL is not an image');
        alert(
          'Error: Selected asset type does not match URL. Please try selecting a different asset.'
        );
        return;
      }
    }

    alert('Short rendering is temporarily unavailable in this build.');
    return;
  } catch (error) {
    console.error('Render error:', error); // includes stack trace

    const hint = summarizeCreateError(error);
    alert(`Render failed${hint ? ': ' + hint : ': ' + (error?.message || 'Unknown error')}`);
  } finally {
    if (renderBtn) {
      renderBtn.disabled = false;
      renderBtn.textContent = originalText;
    }
    if (mobileCreateBtn) {
      mobileCreateBtn.disabled = false;
      mobileCreateBtn.textContent = originalText;
    }
  }
}

// One-Click status overlay helpers
function setOneClickStatus(text) {
  const container = document.getElementById('one-click-status');
  const label = document.getElementById('one-click-status-text');
  if (!container || !label) return;

  if (!text) {
    container.style.opacity = '0';
    label.textContent = '';
    return;
  }

  label.textContent = text;
  container.style.opacity = '1';
}

function clearOneClickStatus() {
  setOneClickStatus('');
}

// URL detection helper
function isUrl(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    // Check if it looks like a URL even if URL constructor fails
    return /^https?:\/\/.+/.test(trimmed);
  }
}

// One-Click Short orchestration function
async function oneClickShort() {
  console.log('[one-click] Starting one-click short flow');

  // Disable buttons during flow
  const oneClickBtn = document.getElementById('one-click-btn');
  const mobileOneClickBtn = document.getElementById('mobile-one-click-btn');
  const originalText = oneClickBtn?.textContent || 'One-Click Short';
  const originalMobileText = mobileOneClickBtn?.textContent || 'One-Click';

  try {
    // Get input from quote box
    const quoteInput = document.getElementById('quote-text');
    const inputText = quoteInput?.value?.trim() || '';

    if (!inputText) {
      showError('quote-error', 'Please enter a URL, quote topic, or text first');
      throw new Error('No input provided');
    }

    // Check if input is a URL
    let isLink = isUrl(inputText);
    let urlToUse = inputText;

    // If textarea doesn't contain a URL but we have a stored story URL, use that
    if (!isLink && currentStoryUrl && currentStorySessionId) {
      console.log('[one-click] Textarea has joined text, using stored URL:', currentStoryUrl);
      isLink = true;
      urlToUse = currentStoryUrl;
    }

    if (isLink) {
      // Use story service pipeline for links
      console.log('[one-click] Detected URL, using story service pipeline');
      await oneClickShortFromLink(urlToUse, oneClickBtn, mobileOneClickBtn);
    } else {
      // Use existing quote flow for non-URLs
      console.log('[one-click] Using quote generation flow');
      await oneClickShortFromQuote(oneClickBtn, mobileOneClickBtn);
    }

    console.log('[one-click] One-click flow completed successfully');
  } catch (error) {
    console.error('[one-click] Error in one-click flow:', error);
    showError('quote-error', error.message || 'One-click flow failed. Please try again.');
  } finally {
    // Restore button states
    if (oneClickBtn) {
      oneClickBtn.disabled = false;
      oneClickBtn.textContent = originalText;
    }
    if (mobileOneClickBtn) {
      mobileOneClickBtn.disabled = false;
      mobileOneClickBtn.textContent = originalMobileText;
    }
    // Clear status overlay with a brief delay
    setTimeout(() => {
      clearOneClickStatus();
    }, 600);
  }
}

// Story service pipeline for links
async function oneClickShortFromLink(url, oneClickBtn, mobileOneClickBtn) {
  const { apiFetch } = await import('/api.mjs');

  let sessionId = null;

  // Check if we can reuse existing story session
  if (currentStorySessionId && currentStoryUrl && currentStoryUrl === url) {
    console.log('[one-click] Reusing existing story session:', currentStorySessionId);
    sessionId = currentStorySessionId;
    setOneClickStatus('Using existing story…');
    if (oneClickBtn) {
      oneClickBtn.disabled = true;
      oneClickBtn.textContent = 'Using existing story...';
    }
    if (mobileOneClickBtn) {
      mobileOneClickBtn.disabled = true;
      mobileOneClickBtn.textContent = 'Using story...';
    }
  } else {
    // Step 1: Create new story session
    setOneClickStatus('Extracting article content…');
    if (oneClickBtn) {
      oneClickBtn.disabled = true;
      oneClickBtn.textContent = 'Extracting content...';
    }
    if (mobileOneClickBtn) {
      mobileOneClickBtn.disabled = true;
      mobileOneClickBtn.textContent = 'Extracting...';
    }

    const startResp = await apiFetch('/story/start', {
      method: 'POST',
      body: {
        input: url,
        inputType: 'link',
      },
    });

    if (!startResp.success || !startResp.data?.id) {
      if (startResp.error === 'AUTH_REQUIRED') {
        showAuthRequiredModal();
        return;
      }
      throw new Error(startResp.error || 'Failed to create story session');
    }

    sessionId = startResp.data.id;
    console.log('[one-click] Story session created:', sessionId);

    // Store for potential future reuse
    currentStorySessionId = sessionId;
    currentStoryUrl = url;
  }

  // Step 2: Finalize story (runs full pipeline: generate → plan → search → render)
  setOneClickStatus('Generating story…');
  if (oneClickBtn) oneClickBtn.textContent = 'Generating story...';
  if (mobileOneClickBtn) mobileOneClickBtn.textContent = 'Generating...';

  // Poll for progress (finalize can take a while)
  const pollInterval = setInterval(() => {
    if (oneClickBtn) {
      const current = oneClickBtn.textContent;
      if (current.includes('Generating')) {
        oneClickBtn.textContent = current.replace('...', '....').replace('....', '...');
      }
    }
  }, 500);

  try {
    const finalizeResp = await apiFetch('/story/finalize', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': sessionId },
      body: { sessionId },
    });

    clearInterval(pollInterval);

    if (!finalizeResp.success) {
      if (finalizeResp.error === 'AUTH_REQUIRED') {
        showAuthRequiredModal();
        return;
      }
      if (finalizeResp.error === 'FREE_LIMIT_REACHED') {
        showFreeLimitModal();
        return;
      }
      throw new Error(
        finalizeResp.error ||
          finalizeResp.message ||
          finalizeResp.detail ||
          'Failed to finalize story'
      );
    }

    const session = finalizeResp.data;

    if (!session.finalVideo?.url) {
      throw new Error('Story generation completed but no video URL found');
    }

    // Extract jobId from finalVideo or from URL path
    let jobId = session.finalVideo?.jobId;
    if (!jobId && session.finalVideo?.url) {
      // Try to extract from URL path: artifacts/{uid}/{jobId}/story.mp4
      const urlMatch = session.finalVideo.url.match(/artifacts\/[^/]+\/([^/]+)\//);
      if (urlMatch) {
        jobId = urlMatch[1];
      }
    }

    if (!jobId) {
      console.warn('[one-click] Could not extract jobId, using session ID');
      jobId = session.id || 'unknown';
    }

    console.log('[one-click] Story finalized, video URL:', session.finalVideo.url, 'jobId:', jobId);

    // Step 3: Display result and redirect to My Shorts
    setOneClickStatus('Complete!');
    if (oneClickBtn) oneClickBtn.textContent = 'Complete!';
    if (mobileOneClickBtn) mobileOneClickBtn.textContent = 'Done!';

    // Show success message and redirect to My Shorts
    showError('quote-error', ''); // Clear any errors

    // Brief success message, then redirect
    const sentenceCount = session.story?.sentences?.length || 0;
    const durationSec = Math.round(session.finalVideo.durationSec || 0);
    alert(
      `Story video created successfully! ${sentenceCount} sentences, ${durationSec}s duration.\n\nRedirecting to My Shorts...`
    );

    // Redirect to My Shorts page with the new video
    try {
      window.location.href = `/my-shorts.html?new=${encodeURIComponent(jobId)}`;
    } catch (e) {
      console.error('[one-click] Failed to redirect:', e);
      // Fallback: try to open My Shorts in same tab
      window.location.href = '/my-shorts.html';
    }
  } catch (error) {
    clearInterval(pollInterval);
    throw error;
  }
}

// Original quote flow for non-URLs
async function oneClickShortFromQuote(oneClickBtn, mobileOneClickBtn) {
  setOneClickStatus('Generating quote…');

  // Step 1: Generate or reuse quote
  console.log('[one-click] Step 1: Generating or reusing quote...');
  if (oneClickBtn) {
    oneClickBtn.disabled = true;
    oneClickBtn.textContent = 'Generating quote...';
  }
  if (mobileOneClickBtn) {
    mobileOneClickBtn.disabled = true;
    mobileOneClickBtn.textContent = 'Generating...';
  }

  let quoteText = '';
  if (currentQuote && currentQuote.text) {
    console.log('[one-click] Reusing existing quote');
    quoteText = currentQuote.text;
  } else {
    const quoteInput = document.getElementById('quote-text');
    quoteText = quoteInput?.value?.trim() || '';

    if (!quoteText) {
      showError('quote-error', 'Please enter a quote topic or text first');
      throw new Error('No quote text provided');
    }

    // Generate quote
    await window.generateQuote();

    // Wait a bit for quote to be set
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (!currentQuote || !currentQuote.text) {
      showError('quote-error', 'Failed to generate quote');
      throw new Error('Quote generation failed');
    }
    quoteText = currentQuote.text;
  }

  setOneClickStatus('Finding background…');

  // Step 2: Build asset search query
  console.log('[one-click] Step 2: Building asset search query...');
  if (oneClickBtn) oneClickBtn.textContent = 'Finding background...';
  if (mobileOneClickBtn) mobileOneClickBtn.textContent = 'Finding...';

  const assetQueryInput = document.getElementById('asset-query');
  const quoteInput = document.getElementById('quote-text');

  let searchQuery = '';
  if (assetQueryInput?.value?.trim()) {
    searchQuery = assetQueryInput.value.trim();
  } else if (quoteInput?.value?.trim()) {
    searchQuery = quoteInput.value.trim();
  } else if (quoteText) {
    // Use first 20 chars of quote text
    searchQuery = quoteText.trim().substring(0, 20);
  } else {
    searchQuery = 'calm'; // Default fallback
  }

  console.log('[one-click] Using search query:', searchQuery);

  // Step 3: Search and select asset
  console.log('[one-click] Step 3: Searching for assets...');

  // Set asset type to videos (prefer videos for shorts)
  if (typeof window !== 'undefined') {
    window.currentAssetType = 'videos';
  }
  currentAssetType = 'videos';

  // Update asset query input
  if (assetQueryInput) {
    assetQueryInput.value = searchQuery;
  }

  // Load assets
  await window.loadAssets(1);

  // Wait for grid to populate (with timeout)
  let attempts = 0;
  let assets = [];
  while (attempts < 10) {
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Try to get assets from cache
    const cacheKey = `${currentAssetType}-${searchQuery}-1`;
    if (assetCache.has(cacheKey)) {
      const cachedData = assetCache.get(cacheKey);
      assets = cachedData.items || [];
      if (assets.length > 0) break;
    }

    // Also check DOM grid
    const grid = document.getElementById('asset-grid');
    if (grid && grid.children.length > 0) {
      // Extract assets from DOM by finding use buttons and their associated asset data
      // Since assets are in closure, we need to get from cache
      if (assetCache.has(cacheKey)) {
        const cachedData = assetCache.get(cacheKey);
        assets = cachedData.items || [];
        break;
      }
    }

    attempts++;
  }

  console.log('[one-click] Found assets:', assets.length);

  // Select best asset (prefer vertical: height >= width)
  let chosenAsset = null;
  if (assets.length > 0) {
    // Prefer vertical assets
    chosenAsset = assets.find((a) => a.height && a.width && a.height >= a.width);

    // Fallback to first result if no vertical found
    if (!chosenAsset) {
      chosenAsset = assets[0];
    }

    console.log('[one-click] Selected asset:', chosenAsset.id);

    // Apply asset to preview
    selectAsset(chosenAsset);

    // Wait for preview to update
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Ensure overlay is visible and properly positioned before saving
    if (useOverlayMode && overlaySystemInitialized) {
      try {
        const stage = document.querySelector('#stage');
        const box = stage?.querySelector('.caption-box');
        if (stage && box) {
          const { ensureOverlayTopAndVisible } = await import('/js/caption-overlay.js');
          ensureOverlayTopAndVisible('#stage');
          // Wait for layout to settle after positioning
          await new Promise((resolve) => requestAnimationFrame(resolve));
        } else {
          console.warn('[one-click] Overlay elements not found, skipping positioning');
        }
      } catch (e) {
        console.warn('[one-click] Overlay positioning failed:', e);
      }
    } else {
      console.log('[one-click] Overlay system not initialized, skipping positioning');
    }
  } else {
    console.log('[one-click] No assets found, will use black background');
    selectedAsset = null;
  }

  // Step 4: Save preview
  console.log('[one-click] Step 4: Saving preview...');
  setOneClickStatus('Saving preview…');
  if (oneClickBtn) oneClickBtn.textContent = 'Saving preview...';
  if (mobileOneClickBtn) mobileOneClickBtn.textContent = 'Saving...';

  // Wait a bit more for preview to stabilize
  await new Promise((resolve) => setTimeout(resolve, 200));

  // Save preview
  await savePreview();

  console.log('[one-click] Preview saved successfully');

  // Step 5: Render
  console.log('[one-click] Step 5: Rendering short...');
  setOneClickStatus('Rendering…');
  if (oneClickBtn) oneClickBtn.textContent = 'Rendering...';
  if (mobileOneClickBtn) mobileOneClickBtn.textContent = 'Rendering...';

  // Render the short
  await renderShort();
}

// Expose to window scope for ui-actions.js
window.oneClickShort = oneClickShort;

// Article mode constants
const MAX_BEATS = 8;
const MAX_BEAT_CHARS = 160;
const MAX_TOTAL_CHARS = 850;
const NEW_BEAT_PLACEHOLDER = '[New beat]';

// Phase 0: Helper to detect placeholder text
function isPlaceholderText(text) {
  if (!text || typeof text !== 'string') return true;
  const trimmed = text.trim();
  return (
    trimmed === '' ||
    trimmed === 'Add text…' ||
    trimmed === 'Add text' ||
    trimmed.toLowerCase() === 'add text…'
  );
}

// Phase 0: Helper to check if beat is valid (has both text and clip)
function isValidBeat(beat) {
  if (!beat) return false;
  const hasText = beat.text && !isPlaceholderText(beat.text);
  const hasClip = beat.selectedClip && beat.selectedClip.url;
  return hasText && hasClip;
}

// Phase 1: Generate stable ID for beats
function generateBeatId() {
  return 'beat-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

// Normalize script text into beats with caps
function normalizeScript(originalText) {
  let didSplitLongBeat = false;
  let didTruncateBeats = false;

  // Split by newlines, trim, drop empty
  let beats = originalText
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Split long beats
  const splitBeats = [];
  for (const beat of beats) {
    if (beat.length > MAX_BEAT_CHARS) {
      didSplitLongBeat = true;
      // Try splitting by sentence boundaries first
      const sentences = beat.split(/([.!?]+)/).filter((s) => s.trim().length > 0);
      const grouped = [];
      let current = '';

      for (let i = 0; i < sentences.length; i++) {
        const test = current + sentences[i];
        if (test.length <= MAX_BEAT_CHARS) {
          current = test;
        } else {
          if (current) grouped.push(current.trim());
          current = sentences[i];
        }
      }
      if (current) grouped.push(current.trim());

      // If still too long, split by comma/space
      const finalSplit = [];
      for (const part of grouped) {
        if (part.length <= MAX_BEAT_CHARS) {
          finalSplit.push(part);
        } else {
          // Split by comma, then space
          const commaParts = part
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          for (const commaPart of commaParts) {
            if (commaPart.length <= MAX_BEAT_CHARS) {
              finalSplit.push(commaPart);
            } else {
              // Split by space
              const words = commaPart.split(/\s+/);
              let line = '';
              for (const word of words) {
                const test = line ? line + ' ' + word : word;
                if (test.length <= MAX_BEAT_CHARS) {
                  line = test;
                } else {
                  if (line) finalSplit.push(line);
                  line = word;
                }
              }
              if (line) finalSplit.push(line);
            }
          }
        }
      }
      splitBeats.push(...finalSplit);
    } else {
      splitBeats.push(beat);
    }
  }

  beats = splitBeats;

  // Truncate to max beats
  if (beats.length > MAX_BEATS) {
    didTruncateBeats = true;
    beats = beats.slice(0, MAX_BEATS);
  }

  // Enforce total char limit (truncate last beat if needed)
  const normalizedText = beats.join('\n');
  if (normalizedText.length > MAX_TOTAL_CHARS) {
    const lastBeat = beats[beats.length - 1];
    const allowedLength = MAX_TOTAL_CHARS - (beats.slice(0, -1).join('\n').length + 1); // +1 for newline
    beats[beats.length - 1] = lastBeat.substring(0, Math.max(0, allowedLength)).trim();
    didTruncateBeats = true;
  }

  const finalNormalizedText = beats.join('\n');
  const originalLength = originalText.length;
  const trimmedChars = Math.max(0, originalLength - finalNormalizedText.length);

  return {
    normalizedBeats: beats,
    trimmedChars,
    didSplitLongBeat,
    didTruncateBeats,
  };
}

// Update script preview counters
function updateScriptCounters() {
  const textarea = document.getElementById('article-script-preview');
  const countersEl = document.getElementById('script-preview-counters');
  if (!textarea || !countersEl) return;

  const text = textarea.value;
  const beats = text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const totalChars = text.length;

  countersEl.textContent = `Beats: ${beats.length} / ${MAX_BEATS} | Total: ${totalChars} / ${MAX_TOTAL_CHARS}`;

  // Update button state (only disable if empty)
  const prepareBtn = document.getElementById('prepare-storyboard-btn');
  if (prepareBtn) {
    prepareBtn.disabled = beats.length === 0;
  }
}

// Beat Editor functions (Phase 1: Mirror mode)
let currentViewMode = 'raw'; // 'raw' or 'beats'

// Phase 2: Raw draft tracking
window.rawDraftText = '';
window.rawDirty = false;
window.pendingBeatParseResult = null;

// Sync textarea from beats array (with guard to prevent input handler firing)
function syncTextareaFromBeats(beats) {
  const textarea = document.getElementById('article-script-preview');
  if (!textarea) return;

  // Set guard flag to prevent input handler from firing
  window._syncingTextarea = true;

  // Join beats with newlines (matching current semantics)
  const text = beats.map((b) => (typeof b === 'string' ? b : b.text)).join('\n');
  textarea.value = text;

  // Reset guard flag after a brief delay to ensure input event doesn't fire
  setTimeout(() => {
    window._syncingTextarea = false;
  }, 0);

  // Update counters
  updateScriptCounters();
}

// Parse textarea into beats array (exact newline semantics)
function parseBeatsFromTextarea(text) {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((text, idx) => ({ id: `beat-${idx}`, text }));
}

// Phase 2: Check if applying beats will change the raw text
function willApplyChangeText(rawText) {
  // Use normalizeScript() as the authority to determine if changes will occur
  const { normalizedBeats, trimmedChars, didSplitLongBeat, didTruncateBeats } =
    normalizeScript(rawText);
  const normalizedText = normalizedBeats.join('\n');

  // Compare original (after basic parse) vs normalized
  const originalBeats = rawText
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const originalText = originalBeats.join('\n');

  // Check for meaningful changes (beat count, truncation, splitting)
  const hasMeaningfulChange =
    normalizedBeats.length !== originalBeats.length || didSplitLongBeat || didTruncateBeats;

  // Check if only whitespace trimming changed (not meaningful)
  const onlyWhitespaceChange =
    !hasMeaningfulChange &&
    normalizedText !== originalText &&
    normalizedBeats.length === originalBeats.length &&
    normalizedBeats.every((beat, idx) => beat === originalBeats[idx].trim());

  // Show banner only for meaningful changes, not whitespace-only
  const willChange =
    hasMeaningfulChange || (!onlyWhitespaceChange && normalizedText !== originalText);

  return {
    willChange,
    normalizedBeats,
    normalizedText,
    originalBeats,
    originalText,
    trimmedChars,
    didSplitLongBeat,
    didTruncateBeats,
    onlyWhitespaceChange,
    stats: {
      originalBeats: originalBeats.length,
      normalizedBeats: normalizedBeats.length,
      originalChars: originalText.length,
      normalizedChars: normalizedText.length,
    },
  };
}

// Phase 2: Show confirm UI for applying beats
function showApplyConfirmDialog(parseResult, onApply, onCancel) {
  // Remove any existing confirm UI
  const existing = document.getElementById('beat-apply-confirm');
  if (existing) {
    existing.remove();
  }

  const scriptSection = document.getElementById('article-script-section');
  if (!scriptSection) return;

  const confirmBanner = document.createElement('div');
  confirmBanner.id = 'beat-apply-confirm';
  confirmBanner.className =
    'p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded mb-2';

  const { stats, didSplitLongBeat, didTruncateBeats, trimmedChars } = parseResult;

  let changesList = [];
  if (stats.originalBeats !== stats.normalizedBeats) {
    changesList.push(`${stats.originalBeats} → ${stats.normalizedBeats} beats`);
  }
  if (didSplitLongBeat) {
    changesList.push('long beats will be split');
  }
  if (didTruncateBeats) {
    changesList.push('beats will be truncated');
  }
  if (trimmedChars > 0) {
    changesList.push(`${trimmedChars} characters will be trimmed`);
  }

  const changesText =
    changesList.length > 0
      ? `Changes: ${changesList.join(', ')}.`
      : 'Your script will be adjusted to fit limits.';

  confirmBanner.innerHTML = `
                <div class="text-sm text-yellow-800 dark:text-yellow-200 mb-2">
                    <strong>Applying Beats will adjust your script to fit limits.</strong>
                </div>
                <div class="text-xs text-yellow-700 dark:text-yellow-300 mb-3">
                    ${changesText}
                    <br>Limits: max 8 beats, 160 chars/beat, 850 total chars.
                </div>
                <div class="flex gap-2">
                    <button
                        id="beat-apply-confirm-btn"
                        class="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded"
                    >
                        Apply & Switch
                    </button>
                    <button
                        id="beat-apply-cancel-btn"
                        class="px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white text-xs rounded"
                    >
                        Cancel
                    </button>
                </div>
            `;

  // Insert before textarea
  const textarea = document.getElementById('article-script-preview');
  if (textarea && textarea.parentNode) {
    textarea.parentNode.insertBefore(confirmBanner, textarea);
  } else {
    scriptSection.appendChild(confirmBanner);
  }

  // Wire up buttons
  const applyBtn = confirmBanner.querySelector('#beat-apply-confirm-btn');
  const cancelBtn = confirmBanner.querySelector('#beat-apply-cancel-btn');

  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      confirmBanner.remove();
      onApply();
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      confirmBanner.remove();
      onCancel();
    });
  }
}

// Render beat editor from current textarea value
function renderBeatEditor() {
  const beatEditor = document.getElementById('beat-editor');
  const beatList = document.getElementById('beat-list');
  const addBeatBtn = document.getElementById('add-beat-btn');
  const countersEl = document.getElementById('beat-editor-counters');
  const textarea = document.getElementById('article-script-preview');

  if (!beatEditor || !beatList || !textarea) return;

  // Parse beats from textarea
  const beats = parseBeatsFromTextarea(textarea.value);

  // Clear existing beats
  beatList.innerHTML = '';

  // Render each beat
  beats.forEach((beat, idx) => {
    const beatRow = document.createElement('div');
    beatRow.className =
      'beat-row flex items-start gap-2 p-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded';
    beatRow.dataset.beatId = beat.id;

    // Beat number badge
    const badge = document.createElement('div');
    badge.className =
      'flex-shrink-0 w-8 h-8 flex items-center justify-center bg-blue-600 text-white text-xs font-semibold rounded';
    badge.textContent = String(idx + 1).padStart(2, '0');

    // Beat input container
    const inputContainer = document.createElement('div');
    inputContainer.className = 'flex-1 flex flex-col gap-1';

    // Beat text input
    const input = document.createElement('input');
    input.type = 'text';
    input.value = beat.text;
    input.setAttribute('data-role', 'beat-input');
    input.dataset.beatId = beat.id; // Stable identifier for session mode mapping
    input.className =
      'w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm text-gray-900 dark:text-white';
    input.style.wordWrap = 'break-word';
    input.style.whiteSpace = 'normal';

    // Character counter
    const charCounter = document.createElement('div');
    charCounter.className = 'text-xs text-gray-500 dark:text-gray-400';
    const charCount = beat.text.length;
    const isOverLimit = charCount > MAX_BEAT_CHARS;
    charCounter.textContent = `${charCount}/160`;
    if (isOverLimit) {
      charCounter.className = 'text-xs text-orange-500 dark:text-orange-400';
    }

    // Prevent Enter key and commit on Enter
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // Commit: trigger update with filtering and commit flag
        const newValue = input.value;
        updateBeatInTextarea(beat.id, newValue, true, true); // filterEmpties=true, commit=true
        // Blur to signal save
        input.blur();
      }
    });

    // Sanitize paste (replace newlines with spaces)
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pastedText = (e.clipboardData || window.clipboardData).getData('text');
      const sanitized = pastedText.replace(/[\r\n]+/g, ' ');
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const currentValue = input.value;
      const newValue = currentValue.substring(0, start) + sanitized + currentValue.substring(end);
      input.value = newValue;

      // Update char counter
      const newCharCount = newValue.length;
      charCounter.textContent = `${newCharCount}/160`;
      if (newCharCount > MAX_BEAT_CHARS) {
        charCounter.className = 'text-xs text-orange-500 dark:text-orange-400';
      } else {
        charCounter.className = 'text-xs text-gray-500 dark:text-gray-400';
      }

      // Sync to textarea (don't filter empties on paste, don't commit)
      updateBeatInTextarea(beat.id, newValue, false, false); // filterEmpties=false, commit=false
    });

    // Update on input
    input.addEventListener('input', () => {
      const newValue = input.value;

      // Update char counter
      const newCharCount = newValue.length;
      charCounter.textContent = `${newCharCount}/160`;
      if (newCharCount > MAX_BEAT_CHARS) {
        charCounter.className = 'text-xs text-orange-500 dark:text-orange-400';
      } else {
        charCounter.className = 'text-xs text-gray-500 dark:text-gray-400';
      }

      // Sync to textarea (don't filter empties on input - preserve what user is typing, don't commit)
      updateBeatInTextarea(beat.id, newValue, false, false); // filterEmpties=false, commit=false
    });

    // Commit on blur (filter empties, commit)
    input.addEventListener('blur', () => {
      const newValue = input.value;
      updateBeatInTextarea(beat.id, newValue, true, true); // filterEmpties=true, commit=true
    });

    inputContainer.appendChild(input);
    inputContainer.appendChild(charCounter);

    beatRow.appendChild(badge);
    beatRow.appendChild(inputContainer);
    beatList.appendChild(beatRow);
  });

  // Auto-focus last beat input if it contains placeholder (newly added)
  const lastBeatRow = beatList.querySelector('.beat-row:last-child');
  if (lastBeatRow) {
    const lastInput = lastBeatRow.querySelector('[data-role="beat-input"]');
    if (lastInput && lastInput.value.trim() === NEW_BEAT_PLACEHOLDER) {
      // Focus and select placeholder text for easy replacement
      lastInput.focus();
      lastInput.select();
    }
  }

  // Update add beat button state
  if (addBeatBtn) {
    addBeatBtn.disabled = beats.length >= MAX_BEATS;
  }

  // Update beat editor counters
  if (countersEl) {
    const totalChars = beats.reduce((sum, b) => sum + b.text.length, 0);
    countersEl.textContent = `Beats: ${beats.length} / ${MAX_BEATS} | Total: ${totalChars} / ${MAX_TOTAL_CHARS}`;
  }
}

// Update a specific beat in the textarea
function updateBeatInTextarea(beatId, newText, filterEmpties = false, commit = false) {
  const beatList = document.getElementById('beat-list');
  if (!beatList) return;

  // ✅ Session mode: Update via API only on commit, preserve sentenceIndex alignment
  if (window.currentStorySession && window.currentStorySessionId) {
    // If not committing, just sync textarea for Raw view consistency (no API, no renderStoryboard)
    if (!commit) {
      // Option 2: Sync textarea from current beat inputs (guarded, no API call)
      const beatRows = Array.from(beatList.querySelectorAll('.beat-row'));
      const beats = beatRows.map((row) => {
        const input = row.querySelector('[data-role="beat-input"]');
        return input ? input.value : '';
      });
      syncTextareaFromBeats(beats);
      return; // Early return - don't run pre-storyboard path
    }

    // Commit path: Update via API, preserve sentenceIndex alignment
    // Trim text (match commitBeatTextEdit behavior)
    const trimmedText = (newText || '').trim();

    // Block empty text commits in session mode (prevent beat deletion)
    // Only enforce when committing (allow empty temporarily while typing)
    if (!trimmedText) {
      showToast(
        'Cannot clear beat text after storyboard is created. Use storyboard card to edit or delete beats.'
      );
      return;
    }

    // Find sentenceIndex by locating the beat row containing this beatId
    const beatRows = Array.from(beatList.querySelectorAll('.beat-row'));
    let sentenceIndex = -1;

    for (let i = 0; i < beatRows.length; i++) {
      const input = beatRows[i].querySelector(
        '[data-role="beat-input"][data-beat-id="' + beatId + '"]'
      );
      if (input) {
        sentenceIndex = i;
        break;
      }
    }

    // Validate sentenceIndex
    if (sentenceIndex < 0 || sentenceIndex >= window.currentStorySession.story.sentences.length) {
      console.error('[beat-editor] Could not map beatId to sentenceIndex:', {
        beatId,
        sentenceIndex,
        sessionSentencesCount: window.currentStorySession.story.sentences.length,
      });
      showToast('Could not update beat. Please refresh the page.');
      return;
    }

    // Commit text update using same API as commitBeatTextEdit()
    handleBeatEditorCommitInSessionMode(sentenceIndex, trimmedText);
    return; // Early return - don't run pre-storyboard path
  }

  // Pre-storyboard mode: Existing behavior (filter empties, sync textarea)
  // Collect all beat values in order (use .beat-row selector for safety)
  const beatRows = Array.from(beatList.querySelectorAll('.beat-row'));
  let beats = beatRows.map((row) => {
    const input = row.querySelector('[data-role="beat-input"]');
    return input ? input.value : '';
  });

  // Only filter empty beats if explicitly requested (on commit)
  if (filterEmpties) {
    beats = beats.map((text) => text.trim()).filter((text) => text.length > 0);
  }

  // Sync to textarea (guarded)
  syncTextareaFromBeats(beats);

  // Only re-render if filtering empties (commit) to update numbering and button state
  if (filterEmpties && currentViewMode === 'beats') {
    renderBeatEditor();
  }
}

// Handle beat editor commit in session mode (reuses commitBeatTextEdit logic)
async function handleBeatEditorCommitInSessionMode(sentenceIndex, text) {
  try {
    const { apiFetch } = await import('/api.mjs');

    const resp = await apiFetch('/story/update-beat-text', {
      method: 'POST',
      body: {
        sessionId: window.currentStorySessionId,
        sentenceIndex: sentenceIndex,
        text: text,
      },
    });

    if (!resp.success) {
      console.error('[beat-editor] Update beat failed:', resp);
      showToast(resp.detail || 'Failed to update beat');
      return;
    }

    const { sentences, shots } = resp.data;

    // Keep session in sync (match commitBeatTextEdit behavior)
    if (!window.currentStorySession.story) {
      window.currentStorySession.story = {};
    }
    window.currentStorySession.story.sentences = sentences;
    window.currentStorySession.shots = shots;

    console.log(
      '[beat-editor] Update beat: sentenceIndex=%d, newText=%s',
      sentenceIndex,
      text.slice(0, 80)
    );

    // Re-render storyboard from canonical data
    await renderStoryboard(window.currentStorySession);
    updateRenderArticleButtonState();

    // Sync textarea from returned sentences (guarded, won't trigger input handler)
    syncTextareaFromBeats(sentences);

    // Re-render beat editor to keep Beat View consistent
    if (currentViewMode === 'beats') {
      renderBeatEditor();
    }

    // Trigger debounced preview (behind feature flag) - schedule after DOM update
    if (window.BEAT_PREVIEW_ENABLED) {
      // explicitStyle: ONLY user/session overrides (empty object if none)
      const rawStyle =
        window.currentStorySession.overlayCaption || window.currentStorySession.captionStyle || {};
      requestAnimationFrame(async () => {
        const { extractStyleOnly } = await import('/js/caption-style-helper.js');
        const explicitStyle = extractStyleOnly(rawStyle);
        const m = window.__beatPreviewModule || (await window.__beatPreviewModulePromise);
        if (m) {
          // Pass numeric sentenceIndex directly (matches session.story.sentences[i])
          m.generateBeatCaptionPreviewDebounced(sentenceIndex, text, explicitStyle);
        }
      });
    }
  } catch (err) {
    console.error('[beat-editor] Update beat error:', err);
    showToast('Could not update beat. Please try again.');
  }
}

// Toggle between Raw and Beat views (Phase 2: with Apply semantics)
function toggleViewMode() {
  const textarea = document.getElementById('article-script-preview');
  const beatEditor = document.getElementById('beat-editor');
  const toggleBtn = document.getElementById('toggle-view-btn');

  if (!textarea || !beatEditor || !toggleBtn) return;

  if (currentViewMode === 'raw') {
    // Phase 2: Check if switching Raw → Beats will change the text
    const rawText = window.rawDirty ? window.rawDraftText : textarea.value;
    const parseResult = willApplyChangeText(rawText);

    if (parseResult.willChange) {
      // Show confirm UI
      window.pendingBeatParseResult = parseResult;
      showApplyConfirmDialog(
        parseResult,
        () => {
          // Apply: Update textarea with normalized text
          window._syncingTextarea = true;
          textarea.value = parseResult.normalizedText;
          setTimeout(() => {
            window._syncingTextarea = false;
          }, 0);

          // Update counters
          updateScriptCounters();

          // Clear dirty state
          window.rawDirty = false;
          window.rawDraftText = textarea.value;
          window.pendingBeatParseResult = null;

          // Switch to Beat view
          currentViewMode = 'beats';
          textarea.classList.add('hidden');
          beatEditor.classList.remove('hidden');
          const countersEl = document.getElementById('script-preview-counters');
          if (countersEl) countersEl.classList.add('hidden');
          toggleBtn.textContent = 'Raw';

          // Render beats from normalized textarea value
          renderBeatEditor();
        },
        () => {
          // Cancel: Do nothing, stay in Raw view
          window.pendingBeatParseResult = null;
        }
      );
    } else {
      // No changes needed, switch immediately
      currentViewMode = 'beats';
      textarea.classList.add('hidden');
      beatEditor.classList.remove('hidden');
      const countersEl = document.getElementById('script-preview-counters');
      if (countersEl) countersEl.classList.add('hidden');
      toggleBtn.textContent = 'Raw';

      // Clear dirty state
      window.rawDirty = false;
      window.rawDraftText = '';

      // Render beats from current textarea value
      renderBeatEditor();
    }
  } else {
    // Switch to Raw view (always immediate)
    currentViewMode = 'raw';
    textarea.classList.remove('hidden');
    beatEditor.classList.add('hidden');
    const countersEl = document.getElementById('script-preview-counters');
    if (countersEl) countersEl.classList.remove('hidden');
    toggleBtn.textContent = 'Beat View';

    // Clear any pending confirm UI
    const existing = document.getElementById('beat-apply-confirm');
    if (existing) {
      existing.remove();
    }
    window.pendingBeatParseResult = null;

    // Textarea is already up to date (beats sync to it on every edit)
  }
}

// Handle add beat button
function handleAddBeat() {
  const textarea = document.getElementById('article-script-preview');
  const addBeatBtn = document.getElementById('add-beat-btn');

  if (!textarea) {
    return;
  }

  // Check if at max beats
  const currentBeats = parseBeatsFromTextarea(textarea.value);

  if (currentBeats.length >= MAX_BEATS) {
    return; // Button should be disabled, but guard anyway
  }

  // Add placeholder beat (non-empty so it creates visible row)
  const currentValue = textarea.value.trim();
  let newValue;
  if (currentValue.length === 0) {
    // Empty textarea: set placeholder directly
    newValue = NEW_BEAT_PLACEHOLDER;
  } else {
    // Append newline + placeholder (ensure exactly one newline boundary)
    const needsNewline = !currentValue.endsWith('\n');
    newValue = currentValue + (needsNewline ? '\n' : '') + NEW_BEAT_PLACEHOLDER;
  }

  // Set guard flag
  window._syncingTextarea = true;
  textarea.value = newValue;
  setTimeout(() => {
    window._syncingTextarea = false;
  }, 0);

  // Update counters
  updateScriptCounters();

  // Re-render beat editor if in beat view
  if (currentViewMode === 'beats') {
    renderBeatEditor();
  }
}

// Wire up Beat Editor event listeners
(function () {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      const toggleBtn = document.getElementById('toggle-view-btn');
      const addBeatBtn = document.getElementById('add-beat-btn');

      if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleViewMode);
      }
      if (addBeatBtn) {
        addBeatBtn.addEventListener('click', handleAddBeat);
      }
    });
  } else {
    // DOM already ready
    const toggleBtn = document.getElementById('toggle-view-btn');
    const addBeatBtn = document.getElementById('add-beat-btn');

    if (toggleBtn) {
      toggleBtn.addEventListener('click', toggleViewMode);
    }
    if (addBeatBtn) {
      addBeatBtn.addEventListener('click', handleAddBeat);
    }
  }
})();

// Article mode functions
async function summarizeArticle() {
  const inputEl = document.getElementById('article-input');
  const errorEl = document.getElementById('article-error');
  const scriptPreviewEl = document.getElementById('article-script-preview');
  const summarizeBtn = document.getElementById('summarize-article-btn');

  if (!inputEl || !scriptPreviewEl) {
    console.error('[article] Missing required elements');
    return;
  }

  const inputText = inputEl.value.trim();
  if (!inputText) {
    showError('article-error', 'Please paste an article link or text');
    return;
  }

  setLoading('summarize-article-btn', true);
  hideError('article-error');

  try {
    const { apiFetch } = await import('/api.mjs');

    // Detect if input is URL or text
    const inputType = isUrl(inputText) ? 'link' : 'paragraph';

    // Read style from dropdown
    const styleKey = document.getElementById('article-style-select')?.value || 'default';

    // Step 1: Create story session
    const startResp = await apiFetch('/story/start', {
      method: 'POST',
      body: {
        input: inputText,
        inputType: inputType,
        styleKey: styleKey,
      },
    });

    if (!startResp.success || !startResp.data?.id) {
      throw new Error(startResp.error || 'Failed to create story session');
    }

    const sessionId = startResp.data.id;
    window.currentStorySessionId = sessionId; // Reuse existing global

    // Step 2: Generate story
    const generateResp = await apiFetch('/story/generate', {
      method: 'POST',
      body: {
        sessionId: sessionId,
      },
    });

    if (!generateResp.success) {
      if (generateResp.error === 'AUTH_REQUIRED') {
        showAuthRequiredModal();
        return;
      }
      if (generateResp.error === 'FREE_LIMIT_REACHED') {
        showFreeLimitModal();
        return;
      }
      throw new Error(generateResp.error || generateResp.message || 'Failed to generate story');
    }

    if (!generateResp.data?.story?.sentences) {
      throw new Error('Failed to generate story');
    }

    // Display sentences in script preview (one per line)
    const sentences = generateResp.data.story.sentences;
    const scriptText = Array.isArray(sentences) ? sentences.join('\n') : String(sentences);

    // Set guard flag to prevent input handler from firing
    window._syncingTextarea = true;
    scriptPreviewEl.value = scriptText;
    setTimeout(() => {
      window._syncingTextarea = false;
    }, 0);

    // Phase 2: Clear raw draft state
    window.rawDirty = false;
    window.rawDraftText = '';

    // Phase 2: Remove any pending confirm banner
    const existingBanner = document.getElementById('beat-apply-confirm');
    if (existingBanner) {
      existingBanner.remove();
    }
    window.pendingBeatParseResult = null;

    // Store original sentences to detect edits
    window.currentStoryOriginalSentences = Array.isArray(sentences)
      ? [...sentences]
      : [String(sentences)];

    // Set script source flag
    window.scriptSource = 'llm';

    // Update counters
    updateScriptCounters();

    // If in beat view, render beat editor
    if (currentViewMode === 'beats') {
      renderBeatEditor();
    }

    console.log('[article] Story generated successfully:', sentences.length, 'sentences');
  } catch (error) {
    console.error('[article] Summarize failed:', error);
    showError('article-error', error.message || 'Failed to summarize article');
  } finally {
    setLoading('summarize-article-btn', false);
  }
}

/**
 * Preserve client caption overrides only if server session doesn't have them.
 * Server is SSOT - only carry forward client overrides when server has nothing meaningful.
 * @param {object} nextSession - Session object from server
 * @param {object} prevSession - Previous window.currentStorySession (may be null)
 */
function preserveCaptionOverrides(nextSession, prevSession) {
  // CRITICAL: Only preserve if same session (prevent style bleed)
  if (!prevSession || nextSession?.id !== prevSession?.id) {
    return; // Different session - don't preserve
  }

  const hasOwn = Object.prototype.hasOwnProperty;
  for (const key of ['overlayCaption', 'captionStyle']) {
    const nextHasNonEmpty =
      hasOwn.call(nextSession || {}, key) &&
      nextSession[key] &&
      Object.keys(nextSession[key]).length > 0;

    const prevHasNonEmpty =
      prevSession && prevSession[key] && Object.keys(prevSession[key]).length > 0;

    // Server wins if it has a non-empty object; otherwise carry forward client overrides.
    if (!nextHasNonEmpty && prevHasNonEmpty) {
      nextSession[key] = prevSession[key];
    }
  }
}

/**
 * Apply caption style settings to current session
 * Extracts style-only fields from UI and POSTs to server
 */
async function applyCaptionStyle() {
  try {
    // Ensure session exists
    if (!window.currentStorySession || !window.currentStorySession.id) {
      showToast('No active session. Please create or load a story first.');
      return;
    }

    const sessionId = window.currentStorySession.id;

    // Build raw style from UI controls (reuse existing captionStyle builder logic)
    const sizePx = 54; // Default - will be overridden by server SSOT
    const opacityPct = parseInt(document.getElementById('caption-opacity')?.value || '85', 10);
    const placement = (
      document.getElementById('caption-placement')?.value || 'bottom'
    ).toLowerCase();
    const selectedWeight = document.getElementById('caption-weight')?.value || 'bold';

    const placementToServerFormat = (uiPlacement) => {
      const mapping = {
        top: { placement: 'top', yPct: 0.1 },
        middle: { placement: 'center', yPct: 0.5 },
        bottom: { placement: 'bottom', yPct: 0.9 },
      };
      return mapping[uiPlacement] || mapping['bottom'];
    };

    const placementData = placementToServerFormat(placement);

    const fontMapping = {
      system: { family: 'DejaVu Sans', weightCss: 'normal' },
      bold: { family: 'DejaVu Sans', weightCss: 'bold' },
      cinematic: { family: 'DejaVu Sans', weightCss: 'bold' },
      minimal: { family: 'DejaVu Sans', weightCss: 'normal' },
    };

    const selectedFont = document.getElementById('caption-font')?.value || 'system';
    const fontConfig = fontMapping[selectedFont] || fontMapping['system'];

    const rawStyle = {
      fontFamily: fontConfig.family,
      weightCss: fontConfig.weightCss,
      fontPx: sizePx,
      color: '#FFFFFF',
      opacity: opacityPct / 100,
      placement: placementData.placement,
      yPct: placementData.yPct,
    };

    // Extract style-only fields (safety guard)
    const { extractStyleOnly } = await import('/js/caption-style-helper.js');
    const styleOnly = extractStyleOnly(rawStyle);

    // Avoid writing empty objects
    if (Object.keys(styleOnly).length === 0) {
      showToast('No caption style settings to save.');
      return;
    }

    // POST to server
    const { apiFetch } = await import('/api.mjs');
    const response = await apiFetch('/story/update-caption-style', {
      method: 'POST',
      body: {
        sessionId,
        overlayCaption: styleOnly,
      },
    });

    if (!response.success) {
      throw new Error(response.error || response.detail || 'Failed to update caption style');
    }

    // Update local session object (optimistic update)
    if (response.data && response.data.overlayCaption) {
      window.currentStorySession.overlayCaption = response.data.overlayCaption;
    }

    showToast('Caption settings applied successfully!');

    // Refresh beat previews with new style
    if (window.BEAT_PREVIEW_ENABLED && window.currentStorySession) {
      const sentences = window.currentStorySession.story?.sentences || [];
      if (sentences.length > 0) {
        const explicitStyle =
          window.currentStorySession.overlayCaption ||
          window.currentStorySession.captionStyle ||
          {};
        const { extractStyleOnly: extractStyleOnlyRefresh } = await import(
          '/js/caption-style-helper.js'
        );
        const safeStyle = extractStyleOnlyRefresh(explicitStyle);
        BeatPreviewManager.applyAllPreviews(sentences, safeStyle);
      }
    }
  } catch (err) {
    console.error('[apply-caption-style] error:', err);
    showToast('Failed to apply caption settings. Please try again.');
  }
}

async function prepareStoryboard() {
  const scriptPreviewEl = document.getElementById('article-script-preview');
  const prepareBtn = document.getElementById('prepare-storyboard-btn');
  const storyboardEl = document.getElementById('storyboard');
  const scriptSection = document.getElementById('article-script-section');

  if (!scriptPreviewEl || !prepareBtn) {
    console.error('[article] Missing required elements');
    return;
  }

  // Check if storyboard is dirty and show confirm if needed
  const dirty = isStoryboardDirty();
  if (dirty) {
    const confirmed = window.confirm(
      'Auto-fill will replace your current storyboard and overwrite any manual changes. Continue?'
    );
    if (!confirmed) {
      return;
    }
  }

  setLoading('prepare-storyboard-btn', true);
  hideError('article-error');

  try {
    const { apiFetch } = await import('/api.mjs');

    // Explicit priority order
    const sessionId = window.currentStorySessionId;
    const scriptSource = window.scriptSource;
    const scriptText = scriptPreviewEl.value.trim();

    // Priority 1: LLM + Session
    if (scriptSource === 'llm' && sessionId) {
      // Keep existing LLM flow unchanged
      const currentSentences = scriptText
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      if (currentSentences.length === 0) {
        throw new Error('Script is empty');
      }

      // Validate no placeholder beats before proceeding
      const hasPlaceholder = currentSentences.some((s) => s.trim() === NEW_BEAT_PLACEHOLDER);
      if (hasPlaceholder) {
        setLoading('prepare-storyboard-btn', false);
        showToast(
          `Replace or delete the '${NEW_BEAT_PLACEHOLDER}' placeholder before building storyboard.`,
          5000
        );
        return;
      }

      // Check if script was edited
      const originalSentences = window.currentStoryOriginalSentences || [];
      const sentencesChanged =
        originalSentences.length !== currentSentences.length ||
        originalSentences.some((s, i) => s !== currentSentences[i]);

      // Update script if changed
      if (sentencesChanged) {
        console.log('[article] Script was edited, updating...');
        const updateResp = await apiFetch('/story/update-script', {
          method: 'POST',
          body: {
            sessionId: sessionId,
            sentences: currentSentences,
          },
        });

        if (!updateResp.success) {
          throw new Error(updateResp.error || 'Failed to update script');
        }

        // Update stored original
        window.currentStoryOriginalSentences = [...currentSentences];
      }

      // Step 1: Plan shots
      const planResp = await apiFetch('/story/plan', {
        method: 'POST',
        body: { sessionId: sessionId },
      });

      if (!planResp.success) {
        throw new Error(planResp.error || 'Failed to plan shots');
      }

      // Step 2: Search clips
      const searchResp = await apiFetch('/story/search', {
        method: 'POST',
        body: { sessionId: sessionId },
      });

      if (!searchResp.success) {
        throw new Error(searchResp.error || 'Failed to search clips');
      }

      const session = searchResp.data;

      // Preserve client caption overrides if server doesn't have them
      const prev = window.currentStorySession;
      preserveCaptionOverrides(session, prev);

      // Store session for clip picker access
      window.currentStorySession = session;

      // Render storyboard
      await renderStoryboard(session);

      // Clear draft state (session is now source of truth)
      // Phase 1: Reset to 1 empty beat
      window.draftStoryboard = { beats: [{ id: generateBeatId(), text: '', selectedClip: null }] };

      // Update render button state (session now exists)
      updateRenderArticleButtonState();

      console.log('[article] Storyboard prepared successfully');
      return;
    }

    // Priority 2: Manual Script (textarea has text)
    if (scriptText.length > 0) {
      // Validate no placeholder beats before normalization
      const rawLines = scriptText
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const hasPlaceholder = rawLines.some((s) => s === NEW_BEAT_PLACEHOLDER);
      if (hasPlaceholder) {
        setLoading('prepare-storyboard-btn', false);
        showToast(
          `Replace or delete the '${NEW_BEAT_PLACEHOLDER}' placeholder before building storyboard.`,
          5000
        );
        return;
      }

      // Get original text before normalization
      const originalText = scriptText;

      // Normalize script
      const { normalizedBeats, trimmedChars, didSplitLongBeat, didTruncateBeats } =
        normalizeScript(originalText);

      // Write normalized beats back into textarea (guarded)
      const normalizedText = normalizedBeats.join('\n');
      window._syncingTextarea = true;
      scriptPreviewEl.value = normalizedText;
      setTimeout(() => {
        window._syncingTextarea = false;
      }, 0);

      // Update counters
      updateScriptCounters();

      // Show toast if normalization occurred
      if (trimmedChars > 0 || didSplitLongBeat || didTruncateBeats) {
        let message = 'Auto-formatted: ';
        if (trimmedChars > 0) {
          message += `trimmed ${trimmedChars} characters `;
        }
        message += 'to fit the max length (8 beats / 850 chars for <1 minute).';
        showToast(message);
      }

      // Validate
      if (normalizedBeats.length === 0) {
        throw new Error('Script is empty after normalization');
      }

      // Call manual endpoint
      const manualResp = await apiFetch('/story/manual', {
        method: 'POST',
        body: {
          scriptText: normalizedText,
        },
      });

      if (!manualResp.success) {
        throw new Error(manualResp.error || 'Failed to create manual story session');
      }

      const newSessionId = manualResp.data.sessionId;
      window.currentStorySessionId = newSessionId;
      window.scriptSource = 'llm'; // Session now exists, treat as LLM path

      // Store original sentences
      window.currentStoryOriginalSentences = [...normalizedBeats];

      // Step 1: Plan shots
      const planResp = await apiFetch('/story/plan', {
        method: 'POST',
        body: { sessionId: newSessionId },
      });

      if (!planResp.success) {
        throw new Error(planResp.error || 'Failed to plan shots');
      }

      // Step 2: Search clips
      const searchResp = await apiFetch('/story/search', {
        method: 'POST',
        body: { sessionId: newSessionId },
      });

      if (!searchResp.success) {
        throw new Error(searchResp.error || 'Failed to search clips');
      }

      const session = searchResp.data;

      // Preserve client caption overrides if server doesn't have them
      const prev = window.currentStorySession;
      preserveCaptionOverrides(session, prev);

      // Store session for clip picker access
      window.currentStorySession = session;

      // Render storyboard
      await renderStoryboard(session);

      // Clear draft state (session is now source of truth)
      // Phase 1: Reset to 1 empty beat
      window.draftStoryboard = { beats: [{ id: generateBeatId(), text: '', selectedClip: null }] };

      // Update render button state (session now exists)
      updateRenderArticleButtonState();

      console.log('[article] Storyboard prepared successfully (manual mode)');
      return;
    }

    // Priority 3: Empty
    showError('article-error', 'Please enter a script or summarize an article first');
    return;
  } catch (error) {
    console.error('[article] Prepare storyboard failed:', error);
    showError('article-error', error.message || 'Failed to prepare storyboard');
  } finally {
    setLoading('prepare-storyboard-btn', false);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Beat preview manager (behind feature flag)
const BeatPreviewManager = {
  /**
   * Apply preview to beat card
   * @param {HTMLElement} beatCardEl - Beat card DOM element
   * @param {number} beatIndex - Beat index in story.sentences array (numeric, required for SSOT)
   * @param {string} text - Beat text
   * @param {object} style - Session-level caption style
   */
  async applyPreview(beatCardEl, beatIndex, text, style) {
    if (!window.BEAT_PREVIEW_ENABLED) return;

    try {
      const { generateBeatCaptionPreview } = await import('/js/caption-preview.js');
      // beatIndex must be numeric (matches session.story.sentences[i])
      const numericBeatIndex =
        typeof beatIndex === 'number'
          ? beatIndex
          : typeof beatIndex === 'string' && /^\d+$/.test(beatIndex)
            ? parseInt(beatIndex, 10)
            : null;
      const result = await generateBeatCaptionPreview(numericBeatIndex ?? beatIndex, text, style);

      if (!result || !result.rasterUrl) return;

      // Find or create overlay img element
      let overlayImg = beatCardEl.querySelector('.beat-caption-overlay');
      if (!overlayImg) {
        overlayImg = document.createElement('img');
        overlayImg.className = 'beat-caption-overlay';
        // Insert into video container (first .relative element)
        const videoContainer = beatCardEl.querySelector('.relative.w-full.h-40');
        if (videoContainer) {
          videoContainer.appendChild(overlayImg);
        } else {
          beatCardEl.appendChild(overlayImg);
        }
      }

      // Set CSS variables for positioning
      const meta = result.meta;
      const yPct = Math.max(0, Math.min(1, meta.yPx_png / meta.frameH));
      const rasterWRatio = meta.rasterW / meta.frameW;
      const rasterHRatio = meta.rasterH / meta.frameH;

      overlayImg.style.setProperty('--y-pct', yPct);
      overlayImg.style.setProperty('--raster-w-ratio', rasterWRatio);
      overlayImg.style.setProperty('--raster-h-ratio', rasterHRatio);

      // Set image source
      overlayImg.src = result.rasterUrl;
      overlayImg.style.display = 'block';
    } catch (err) {
      if (window.__parityAudit || window.__parityDebug) {
        console.warn('[beat-preview] Failed to apply preview:', err);
      }
      // Graceful degradation - don't block UI
    }
  },

  /**
   * Apply previews to all beats in storyboard
   */
  async applyAllPreviews(beats, style) {
    if (!window.BEAT_PREVIEW_ENABLED) return;

    for (let idx = 0; idx < beats.length; idx++) {
      const beat = beats[idx];
      // Handle both draft beats (object with id/text) and session sentences (string)
      const beatId = beat.id || beat.sentenceIndex || idx;
      const text = beat.text || (typeof beat === 'string' ? beat : '');
      // beatIndex must be numeric array index (matches session.story.sentences[i])
      const beatIndex = typeof beat.sentenceIndex === 'number' ? beat.sentenceIndex : idx;
      const beatCardEl =
        document.querySelector(`[data-beat-id="${beatId}"]`) ||
        document.querySelector(`[data-sentence-index="${idx}"]`);
      if (beatCardEl && text) {
        // Pass numeric beatIndex (matches session.story.sentences[i])
        await BeatPreviewManager.applyPreview(beatCardEl, beatIndex, text, style);
      }
    }
  },
};

// Feature flag (default true)
if (typeof window.BEAT_PREVIEW_ENABLED === 'undefined') {
  window.BEAT_PREVIEW_ENABLED = true; // Enable by default
}

// Preload caption-preview module at boot (deterministic init)
window.__beatPreviewModulePromise = import('/js/caption-preview.js')
  .then((m) => ((window.__beatPreviewModule = m), m))
  .catch((err) => (console.warn('[beat-preview] Module load failed:', err), null));

// Optional debug exposure (only if flag is set)
if (window.__beatPreviewDebug === true) {
  window.BeatPreviewManager = BeatPreviewManager;
}

async function renderStoryboard(session) {
  const storyboardRow = document.getElementById('storyboard-row');
  const storyboardEl = document.getElementById('storyboard');

  if (!storyboardRow || !storyboardEl) {
    console.error('[article] Storyboard elements not found');
    return;
  }

  // Clear existing cards
  storyboardRow.innerHTML = '';

  const sentences = session.story?.sentences || [];
  const shots = session.shots || [];

  // Guard: handle mismatched counts gracefully
  if (sentences.length !== shots.length) {
    console.warn(
      `[article] Mismatched counts: ${sentences.length} sentences, ${shots.length} shots`
    );
  }

  sentences.forEach((sentence, idx) => {
    // Find matching shot by sentenceIndex
    const shot = shots.find((s) => s.sentenceIndex === idx) || shots[idx];

    const card = document.createElement('div');
    card.className =
      'beat-card relative w-40 h-[420px] flex-shrink-0 bg-black rounded-lg overflow-hidden border border-gray-700';
    card.setAttribute('data-sentence-index', idx);

    if (!shot || !shot.selectedClip) {
      // Placeholder for missing clip
      card.innerHTML = `
                        <div class="relative w-full h-40 beat-video-container bg-gray-800 flex items-center justify-center">
                            <p class="text-xs text-gray-400 text-center px-2">No clip found</p>
                            <div class="beat-controls">
                                <button
                                    class="delete-beat-btn absolute top-1 right-1 w-6 h-6 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs flex items-center justify-center z-50"
                                    data-sentence-index="${idx}"
                                    title="Delete beat"
                                >✕</button>
                            </div>
                        </div>
                        <div 
                            class="beat-text p-2 text-xs text-gray-200 h-24 overflow-hidden cursor-text"
                            data-sentence-index="${idx}"
                            title="Click to edit"
                        >
                            ${escapeHtml(sentence)}
                        </div>
                        <button
                            class="swap-clip-btn mt-1 mx-2 mb-2 w-[calc(100%-1rem)] text-xs py-1 rounded bg-slate-700 hover:bg-slate-600 text-white"
                            data-sentence-index="${idx}"
                        >
                            Swap clip
                        </button>
                    `;
    } else {
      const clip = shot.selectedClip;
      const videoUrl = clip.url || '';
      const thumbUrl = clip.thumbUrl || '';

      card.innerHTML = `
                        <div class="relative w-full h-40 beat-video-container overflow-hidden">
                            <video
                                src="${videoUrl}"
                                ${thumbUrl ? `poster="${thumbUrl}"` : ''}
                                muted
                                loop
                                preload="none"
                                class="w-full h-full object-cover transition-transform duration-150 storyboard-video"
                                data-index="${idx}"
                                aria-label="Preview for: ${sentence.substring(0, 50)}"
                            ></video>
                            <div class="beat-controls">
                                <button
                                    class="delete-beat-btn absolute top-1 right-1 w-6 h-6 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs flex items-center justify-center z-50"
                                    data-sentence-index="${idx}"
                                    title="Delete beat"
                                >✕</button>
                            </div>
                        </div>
                        <div 
                            class="beat-text p-2 text-xs text-gray-200 h-24 overflow-hidden cursor-text"
                            data-sentence-index="${idx}"
                            title="Click to edit"
                        >
                            ${escapeHtml(sentence)}
                        </div>
                        <button
                            class="swap-clip-btn mt-1 mx-2 mb-2 w-[calc(100%-1rem)] text-xs py-1 rounded bg-slate-700 hover:bg-slate-600 text-white"
                            data-sentence-index="${idx}"
                        >
                            Swap clip
                        </button>
                    `;
    }

    storyboardRow.appendChild(card);

    // Add "Add beat" button after each card
    const addBtn = document.createElement('button');
    addBtn.className = 'add-beat-btn mx-2 flex-shrink-0';
    addBtn.setAttribute('data-insert-after-index', idx);
    addBtn.setAttribute('title', 'Add clip');
    addBtn.textContent = '+';
    storyboardRow.appendChild(addBtn);
  });

  // Add final "Add beat" button after the last card
  if (sentences.length > 0) {
    const finalAddBtn = document.createElement('button');
    finalAddBtn.className = 'add-beat-btn mx-2 flex-shrink-0';
    finalAddBtn.setAttribute('data-insert-after-index', sentences.length - 1);
    finalAddBtn.setAttribute('title', 'Add clip');
    finalAddBtn.textContent = '+';
    storyboardRow.appendChild(finalAddBtn);
  }

  // Show storyboard
  storyboardEl.classList.remove('hidden');

  // Setup hover interactions (desktop-only)
  setupStoryboardHover();

  // Setup swap button click handlers
  setupSwapButtonHandlers();

  // Update render button state (session exists)
  updateRenderArticleButtonState();

  // Video Cuts (beta) panel: show and refresh when storyboard is rendered
  refreshVideoCutsPanel();

  // Apply beat previews (behind feature flag)
  if (window.BEAT_PREVIEW_ENABLED) {
    // explicitStyle: ONLY user/session overrides (empty object if none)
    const rawStyle = session.overlayCaption || session.captionStyle || {};
    const { extractStyleOnly } = await import('/js/caption-style-helper.js');
    const explicitStyle = extractStyleOnly(rawStyle);
    await BeatPreviewManager.applyAllPreviews(sentences, explicitStyle);
  }
}

let videoCutsPanelListenersAttached = false;
function refreshVideoCutsPanel() {
  const panel = document.getElementById('video-cuts-panel');
  if (!panel) return;
  const session = window.currentStorySession;
  const enabled = !!(window.ENABLE_VIDEO_CUTS_UI && session?.story?.sentences?.length >= 2);
  if (!enabled) {
    panel.classList.add('hidden');
    return;
  }
  const N = session.story.sentences.length;
  panel.classList.remove('hidden');
  if (!videoCutsPanelListenersAttached) {
    setupVideoCutsPanelListeners();
    videoCutsPanelListenersAttached = true;
  }
  // Boundary select: 0..N-2
  const boundarySelect = document.getElementById('video-cuts-boundary-index');
  if (boundarySelect) {
    boundarySelect.innerHTML = '';
    for (let i = 0; i <= N - 2; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = 'Between beat ' + i + '–' + (i + 1);
      boundarySelect.appendChild(opt);
    }
  }
  const editIdx = boundarySelect ? parseInt(boundarySelect.value, 10) || 0 : 0;
  const beatIndexInput = document.getElementById('video-cuts-beat-index');
  if (beatIndexInput) {
    beatIndexInput.min = editIdx + 1;
    beatIndexInput.max = N - 1;
    const val = parseInt(beatIndexInput.value, 10);
    if (isNaN(val) || val < editIdx + 1 || val > N - 1) {
      beatIndexInput.value = editIdx + 1;
    }
  }
  const pctEl = document.getElementById('video-cuts-pct-value');
  const pctSlider = document.getElementById('video-cuts-pct');
  if (pctEl && pctSlider) pctEl.textContent = pctSlider.value;
  // Warning: any beat missing selectedClip.url
  const shots = session.shots || [];
  const missing = [];
  for (let i = 0; i < N; i++) {
    const shot = shots.find((s) => s.sentenceIndex === i) || shots[i];
    if (!shot?.selectedClip?.url) missing.push(i);
  }
  const warningEl = document.getElementById('video-cuts-warning');
  if (warningEl) {
    if (missing.length > 0) {
      warningEl.textContent =
        'Some beats have no clip (beat ' +
        missing.join(', ') +
        '). Backend will fall back; video cuts may not apply.';
      warningEl.classList.remove('hidden');
    } else {
      warningEl.textContent = '';
      warningEl.classList.add('hidden');
    }
  }
  const debugPre = document.getElementById('video-cuts-debug');
  if (debugPre) {
    debugPre.textContent = JSON.stringify(session.videoCutsV1 ?? null, null, 2);
  }
}

function setupVideoCutsPanelListeners() {
  const boundarySelect = document.getElementById('video-cuts-boundary-index');
  const beatIndexInput = document.getElementById('video-cuts-beat-index');
  const pctSlider = document.getElementById('video-cuts-pct');
  const pctValue = document.getElementById('video-cuts-pct-value');
  if (pctSlider && pctValue) {
    pctSlider.addEventListener('input', function () {
      pctValue.textContent = pctSlider.value;
    });
  }
  if (boundarySelect && beatIndexInput) {
    boundarySelect.addEventListener('change', function () {
      refreshVideoCutsPanel();
    });
  }
  const saveBtn = document.getElementById('video-cuts-save-btn');
  const resetBtn = document.getElementById('video-cuts-reset-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async function () {
      const session = window.currentStorySession;
      const sessionId = window.currentStorySessionId;
      if (!session || !sessionId) {
        if (typeof showToast === 'function') showToast('No session. Create or load a story first.');
        return;
      }
      const N = session.story?.sentences?.length ?? 0;
      if (N < 2) return;
      const boundarySelectEl = document.getElementById('video-cuts-boundary-index');
      const beatIndexEl = document.getElementById('video-cuts-beat-index');
      const pctEl = document.getElementById('video-cuts-pct');
      const editIdx = boundarySelectEl ? parseInt(boundarySelectEl.value, 10) || 0 : 0;
      const beatIndex = beatIndexEl ? parseInt(beatIndexEl.value, 10) : editIdx + 1;
      const pct = pctEl ? parseFloat(pctEl.value) : 0.35;
      const minBeat = editIdx + 1;
      const clampedBeatIndex = Math.max(minBeat, Math.min(N - 1, beatIndex));
      const boundaries = [];
      for (let i = 0; i <= N - 2; i++) {
        boundaries.push({
          leftBeat: i,
          pos:
            i === editIdx
              ? { beatIndex: clampedBeatIndex, pct: pct }
              : { beatIndex: i + 1, pct: 0 },
        });
      }
      try {
        const { apiFetch } = await import('/api.mjs');
        const resp = await apiFetch('/story/update-video-cuts', {
          method: 'POST',
          body: { sessionId, videoCutsV1: { version: 1, boundaries } },
        });
        if (resp.success && resp.data) {
          window.currentStorySession = resp.data;
          if (typeof showToast === 'function') showToast('Saved video cuts');
          refreshVideoCutsPanel();
        } else {
          const msg = resp.error || resp.detail || 'Failed to save video cuts';
          if (typeof showToast === 'function') showToast(msg);
          else console.error('[video-cuts]', msg);
        }
      } catch (e) {
        if (typeof showToast === 'function') showToast(e?.message || 'Failed to save video cuts');
        console.error('[video-cuts]', e);
      }
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener('click', async function () {
      const sessionId = window.currentStorySessionId;
      if (!sessionId) {
        if (typeof showToast === 'function') showToast('No session.');
        return;
      }
      try {
        const { apiFetch } = await import('/api.mjs');
        const resp = await apiFetch('/story/update-video-cuts', {
          method: 'POST',
          body: { sessionId, videoCutsV1: { version: 1, boundaries: [] } },
        });
        if (resp.success && resp.data) {
          window.currentStorySession = resp.data;
          if (typeof showToast === 'function') showToast('Reset video cuts');
          refreshVideoCutsPanel();
        } else {
          const msg = resp.error || resp.detail || 'Failed to reset video cuts';
          if (typeof showToast === 'function') showToast(msg);
          else console.error('[video-cuts]', msg);
        }
      } catch (e) {
        if (typeof showToast === 'function') showToast(e?.message || 'Failed to reset video cuts');
        console.error('[video-cuts]', e);
      }
    });
  }
}

function renderDraftStoryboard() {
  const storyboardRow = document.getElementById('storyboard-row');
  const storyboardEl = document.getElementById('storyboard');

  if (!storyboardRow || !storyboardEl) {
    console.error('[article] Storyboard elements not found');
    return;
  }

  // Clear existing cards
  storyboardRow.innerHTML = '';

  const beats = window.draftStoryboard.beats || [];

  // Phase 1: Use beat IDs instead of indices
  beats.forEach((beat) => {
    if (!beat.id) {
      // Migrate old beats without IDs
      beat.id = generateBeatId();
    }

    const card = document.createElement('div');
    card.className =
      'beat-card relative w-40 h-[420px] flex-shrink-0 bg-black rounded-lg overflow-hidden border border-gray-700';
    card.setAttribute('data-beat-id', beat.id);
    card.setAttribute('data-draft', 'true');

    if (!beat.selectedClip) {
      // Placeholder for missing clip
      card.innerHTML = `
                        <div 
                            class="relative w-full h-40 beat-video-container bg-gray-800 flex items-center justify-center cursor-pointer hover:bg-gray-700 transition"
                            data-beat-id="${beat.id}"
                            data-draft="true"
                            data-add-clip="true"
                            title="Click to add clip"
                        >
                            <p class="text-xs text-gray-400 text-center px-2">+ Add clip</p>
                            <div class="beat-controls">
                                <button
                                    class="delete-beat-btn absolute top-1 right-1 w-6 h-6 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs flex items-center justify-center z-50"
                                    data-beat-id="${beat.id}"
                                    data-draft="true"
                                    title="Delete beat"
                                >✕</button>
                            </div>
                        </div>
                        <div 
                            class="beat-text p-2 text-xs text-gray-200 h-24 overflow-hidden cursor-text"
                            data-beat-id="${beat.id}"
                            data-draft="true"
                            title="Click to edit"
                        >
                            ${escapeHtml(beat.text || 'Add text…')}
                        </div>
                        <button
                            class="swap-clip-btn mt-1 mx-2 mb-2 w-[calc(100%-1rem)] text-xs py-1 rounded bg-slate-700 hover:bg-slate-600 text-white"
                            data-beat-id="${beat.id}"
                            data-draft="true"
                        >
                            Swap clip
                        </button>
                    `;
    } else {
      const clip = beat.selectedClip;
      const videoUrl = clip.url || '';
      const thumbUrl = clip.thumbUrl || '';

      card.innerHTML = `
                        <div class="relative w-full h-40 beat-video-container overflow-hidden">
                            <video
                                src="${videoUrl}"
                                ${thumbUrl ? `poster="${thumbUrl}"` : ''}
                                muted
                                loop
                                preload="none"
                                class="w-full h-full object-cover transition-transform duration-150 storyboard-video"
                                data-beat-id="${beat.id}"
                                aria-label="Preview for: ${(beat.text || '').substring(0, 50)}"
                            ></video>
                            <div class="beat-controls">
                                <button
                                    class="delete-beat-btn absolute top-1 right-1 w-6 h-6 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs flex items-center justify-center z-50"
                                    data-beat-id="${beat.id}"
                                    data-draft="true"
                                    title="Delete beat"
                                >✕</button>
                            </div>
                        </div>
                        <div 
                            class="beat-text p-2 text-xs text-gray-200 h-24 overflow-hidden cursor-text"
                            data-beat-id="${beat.id}"
                            data-draft="true"
                            title="Click to edit"
                        >
                            ${escapeHtml(beat.text || 'Add text…')}
                        </div>
                        <button
                            class="swap-clip-btn mt-1 mx-2 mb-2 w-[calc(100%-1rem)] text-xs py-1 rounded bg-slate-700 hover:bg-slate-600 text-white"
                            data-beat-id="${beat.id}"
                            data-draft="true"
                        >
                            Swap clip
                        </button>
                    `;
    }

    storyboardRow.appendChild(card);
  });

  // Phase 1: Add "+ Add beat" button after last beat (if under max)
  if (beats.length < MAX_BEATS) {
    const addBtn = document.createElement('button');
    addBtn.className =
      'add-beat-btn mx-2 flex-shrink-0 w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-lg flex items-center justify-center';
    addBtn.setAttribute('data-draft', 'true');
    addBtn.setAttribute('title', 'Add beat');
    addBtn.textContent = '+';
    storyboardRow.appendChild(addBtn);
  }

  // Show storyboard
  storyboardEl.classList.remove('hidden');

  // Setup hover interactions (desktop-only)
  setupStoryboardHover();

  // Setup swap button click handlers
  setupSwapButtonHandlers();

  // Update render button state (draft mode)
  updateRenderArticleButtonState();

  // Apply beat previews (behind feature flag)
  if (window.BEAT_PREVIEW_ENABLED) {
    const style = window.draftStoryboard?.captionStyle || {
      fontFamily: 'DejaVu Sans',
      weightCss: 'bold',
      fontPx: 48,
      yPct: 0.5,
      wPct: 0.8,
      opacity: 1,
      color: '#FFFFFF',
    };
    BeatPreviewManager.applyAllPreviews(beats, style);
  }
}

function setupSwapButtonHandlers() {
  const storyboardRow = document.getElementById('storyboard-row');
  if (!storyboardRow) return;

  // Remove existing listener to avoid duplicates
  storyboardRow.removeEventListener('click', handleSwapButtonClick);

  // Add click handler
  storyboardRow.addEventListener('click', handleSwapButtonClick);
}

function handleSwapButtonClick(e) {
  const isDraft = !window.currentStorySessionId;

  // Handle swap clip button
  const swapBtn = e.target.closest('.swap-clip-btn');
  if (swapBtn) {
    if (isDraft) {
      // Phase 1: Draft mode uses beatId
      const beatId = swapBtn.dataset.beatId;
      if (!beatId) {
        console.error('[article] Invalid beat ID:', swapBtn.dataset.beatId);
        return;
      }
      openClipPicker(beatId, true);
    } else {
      // Session mode uses sentenceIndex
      const sentenceIndex = Number(swapBtn.dataset.sentenceIndex);
      if (isNaN(sentenceIndex)) {
        console.error('[article] Invalid sentence index:', swapBtn.dataset.sentenceIndex);
        return;
      }
      openClipPicker(sentenceIndex, false);
    }
    return;
  }

  // Handle "+ Add clip" placeholder click
  const addClipPlaceholder = e.target.closest('[data-add-clip="true"]');
  if (addClipPlaceholder) {
    if (isDraft) {
      // Phase 1: Draft mode uses beatId
      const beatId = addClipPlaceholder.dataset.beatId;
      if (!beatId) {
        console.error('[article] Invalid beat ID:', addClipPlaceholder.dataset.beatId);
        return;
      }
      openClipPicker(beatId, true);
    } else {
      // Session mode uses sentenceIndex
      const sentenceIndex = Number(addClipPlaceholder.dataset.sentenceIndex);
      if (isNaN(sentenceIndex)) {
        console.error(
          '[article] Invalid sentence index:',
          addClipPlaceholder.dataset.sentenceIndex
        );
        return;
      }
      openClipPicker(sentenceIndex, false);
    }
    return;
  }

  // Phase 1: Handle add beat button (draft mode only)
  const addBtn = e.target.closest('.add-beat-btn');
  if (addBtn && addBtn.dataset.draft === 'true') {
    if (window.draftStoryboard.beats.length >= MAX_BEATS) {
      alert(`Maximum of ${MAX_BEATS} beats allowed`);
      return;
    }
    handleAddDraftBeat();
    return;
  }

  // Handle add beat button (session mode)
  if (addBtn && !isDraft) {
    const insertAfterIndex = Number(addBtn.dataset.insertAfterIndex);
    if (isNaN(insertAfterIndex)) {
      console.error('[article] Invalid insert after index:', addBtn.dataset.insertAfterIndex);
      return;
    }

    const text = prompt('New beat text:');
    if (!text || !text.trim()) {
      return;
    }

    handleInsertBeat(insertAfterIndex, text.trim());
    return;
  }

  // Phase 1: Handle delete beat button (draft mode)
  const deleteBtn = e.target.closest('.delete-beat-btn');
  if (deleteBtn && deleteBtn.dataset.draft === 'true') {
    const beatId = deleteBtn.dataset.beatId;
    if (!beatId) {
      console.error('[article] Invalid beat ID:', deleteBtn.dataset.beatId);
      return;
    }

    if (!confirm('Delete this beat?')) {
      return;
    }

    handleDeleteDraftBeat(beatId);
    return;
  }

  // Handle delete beat button (session mode)
  if (deleteBtn && !isDraft) {
    const sentenceIndex = Number(deleteBtn.dataset.sentenceIndex);
    if (isNaN(sentenceIndex)) {
      console.error('[article] Invalid sentence index:', deleteBtn.dataset.sentenceIndex);
      return;
    }

    if (!confirm('Delete this beat?')) {
      return;
    }

    handleDeleteBeat(sentenceIndex);
    return;
  }

  // Handle click on beat text (NEW)
  const textEl = e.target.closest('.beat-text');
  if (textEl) {
    handleEditBeatInline(textEl);
    return;
  }

  // Handle click on beat card (Focus Preview)
  const card = e.target.closest('[data-beat-id], [data-sentence-index]');
  if (card) {
    // Ignore clicks on interactive elements
    const interactive = e.target.closest(
      'button, .beat-text, input, textarea, select, [contenteditable="true"]'
    );
    if (!interactive) {
      showBeatFocusPreview(card);
      return;
    }
  }
}

// Beat Focus Preview Modal
function showBeatFocusPreview(card) {
  if (window.__beatFocusDebug) {
    console.log('[beat-focus] Showing preview for card:', card);
  }

  const modal = document.getElementById('beat-focus-modal');
  const videoEl = document.getElementById('beat-focus-video');
  const overlayImg = document.getElementById('beat-focus-overlay');
  const textEl = document.getElementById('beat-focus-text');
  const noteEl = document.getElementById('beat-focus-preview-note');

  if (!modal || !videoEl || !overlayImg || !textEl || !noteEl) {
    console.error('[beat-focus] Modal elements not found');
    return;
  }

  // Extract video source and poster
  const cardVideo = card.querySelector('video.storyboard-video');
  if (cardVideo && cardVideo.src) {
    videoEl.src = cardVideo.src;

    // Copy poster to match thumbnail still
    const poster = cardVideo.getAttribute('poster');
    if (poster) {
      videoEl.setAttribute('poster', poster);
    } else {
      videoEl.removeAttribute('poster');
    }

    videoEl.load();
    videoEl.pause(); // Show poster initially
    videoEl.currentTime = 0;
  } else {
    if (window.__beatFocusDebug) {
      console.warn('[beat-focus] No video source found');
    }
  }

  // Extract caption overlay if present
  const cardOverlay = card.querySelector('.beat-caption-overlay');
  if (cardOverlay && cardOverlay.src) {
    overlayImg.src = cardOverlay.src;
    overlayImg.style.display = 'block';

    // Copy CSS variables
    const yPct =
      cardOverlay.style.getPropertyValue('--y-pct') ||
      getComputedStyle(cardOverlay).getPropertyValue('--y-pct');
    const rasterWRatio =
      cardOverlay.style.getPropertyValue('--raster-w-ratio') ||
      getComputedStyle(cardOverlay).getPropertyValue('--raster-w-ratio');
    const rasterHRatio =
      cardOverlay.style.getPropertyValue('--raster-h-ratio') ||
      getComputedStyle(cardOverlay).getPropertyValue('--raster-h-ratio');

    if (yPct) overlayImg.style.setProperty('--y-pct', yPct);
    if (rasterWRatio) overlayImg.style.setProperty('--raster-w-ratio', rasterWRatio);
    if (rasterHRatio) overlayImg.style.setProperty('--raster-h-ratio', rasterHRatio);

    noteEl.style.display = 'none';
  } else {
    overlayImg.style.display = 'none';
    noteEl.style.display = 'block';
  }

  // Extract text
  const cardText = card.querySelector('.beat-text');
  if (cardText) {
    textEl.textContent = cardText.textContent || '';
  } else {
    textEl.textContent = '';
  }

  // Show modal
  modal.classList.add('show');

  // Video is paused initially to show poster (matching thumbnail behavior)
  // User can interact to play if desired
}

function hideBeatFocusPreview() {
  const modal = document.getElementById('beat-focus-modal');
  const videoEl = document.getElementById('beat-focus-video');

  if (modal) {
    modal.classList.remove('show');
  }

  if (videoEl) {
    videoEl.pause();
    videoEl.currentTime = 0;
  }
}

// Setup modal close handlers
function setupBeatFocusModal() {
  const modal = document.getElementById('beat-focus-modal');
  const closeBtn = document.getElementById('beat-focus-close');

  if (!modal || !closeBtn) return;

  // Close button
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    hideBeatFocusPreview();
  });

  // Backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      hideBeatFocusPreview();
    }
  });

  // ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('show')) {
      hideBeatFocusPreview();
    }
  });
}

// Initialize modal on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupBeatFocusModal);
} else {
  setupBeatFocusModal();
}

// Phase 1: Add beat to draft storyboard
function handleAddDraftBeat() {
  if (!window.draftStoryboard || !window.draftStoryboard.beats) {
    window.draftStoryboard = { beats: [{ id: generateBeatId(), text: '', selectedClip: null }] };
  }

  if (window.draftStoryboard.beats.length >= MAX_BEATS) {
    alert(`Maximum of ${MAX_BEATS} beats allowed`);
    return;
  }

  // Add new beat at the end
  window.draftStoryboard.beats.push({
    id: generateBeatId(),
    text: '',
    selectedClip: null,
  });

  // Re-render draft storyboard
  renderDraftStoryboard();
  updateRenderArticleButtonState();
}

// Phase 1: Delete beat from draft storyboard
function handleDeleteDraftBeat(beatId) {
  if (!window.draftStoryboard || !window.draftStoryboard.beats) {
    return;
  }

  // Remove beat by ID
  const index = window.draftStoryboard.beats.findIndex((b) => b.id === beatId);
  if (index === -1) {
    console.error('[article] Beat not found:', beatId);
    return;
  }

  window.draftStoryboard.beats.splice(index, 1);

  // If no beats left, add one empty beat
  if (window.draftStoryboard.beats.length === 0) {
    window.draftStoryboard.beats.push({
      id: generateBeatId(),
      text: '',
      selectedClip: null,
    });
  }

  // Re-render draft storyboard
  renderDraftStoryboard();
  updateRenderArticleButtonState();
}

async function handleInsertBeat(insertAfterIndex, text) {
  const sessionId = window.currentStorySessionId;
  if (!sessionId) {
    showError('article-error', 'Session not found');
    return;
  }

  try {
    const { apiFetch } = await import('/api.mjs');

    const resp = await apiFetch('/story/insert-beat', {
      method: 'POST',
      body: {
        sessionId: sessionId,
        insertAfterIndex: insertAfterIndex,
        text: text,
      },
    });

    if (!resp.success) {
      throw new Error(resp.error || 'Failed to insert beat');
    }

    // Update local session
    if (window.currentStorySession) {
      if (!window.currentStorySession.story) {
        window.currentStorySession.story = {};
      }
      window.currentStorySession.story.sentences = resp.data.sentences;
      window.currentStorySession.shots = resp.data.shots;
    }

    // Re-render storyboard
    renderStoryboard(window.currentStorySession);

    console.log(
      `[article] Insert beat: insertAfterIndex=${insertAfterIndex}, new length=${resp.data.sentences.length}`
    );
  } catch (error) {
    console.error('[article] Insert beat failed:', error);
    showError('article-error', error.message || 'Failed to insert beat');
  }
}

async function handleDeleteBeat(sentenceIndex) {
  const sessionId = window.currentStorySessionId;
  if (!sessionId) {
    showError('article-error', 'Session not found');
    return;
  }

  try {
    const { apiFetch } = await import('/api.mjs');

    const resp = await apiFetch('/story/delete-beat', {
      method: 'POST',
      body: {
        sessionId: sessionId,
        sentenceIndex: sentenceIndex,
      },
    });

    if (!resp.success) {
      throw new Error(resp.error || 'Failed to delete beat');
    }

    // Update local session
    if (window.currentStorySession) {
      if (!window.currentStorySession.story) {
        window.currentStorySession.story = {};
      }
      window.currentStorySession.story.sentences = resp.data.sentences;
      window.currentStorySession.shots = resp.data.shots;
    }

    // Re-render storyboard
    renderStoryboard(window.currentStorySession);

    console.log(
      `[article] Delete beat: sentenceIndex=${sentenceIndex}, new length=${resp.data.sentences.length}`
    );
  } catch (error) {
    console.error('[article] Delete beat failed:', error);
    showError('article-error', error.message || 'Failed to delete beat');
  }
}

// Inline editing state
let currentBeatEditing = null; // { el, sentenceIndex, originalText } or null

function isStoryboardDirty() {
  // If session exists, check session beats
  if (window.currentStorySessionId && window.currentStorySession) {
    const shots = window.currentStorySession.shots || [];
    const sentences = window.currentStorySession.story?.sentences || [];

    for (let i = 0; i < Math.max(shots.length, sentences.length); i++) {
      const shot = shots.find((s) => s.sentenceIndex === i) || shots[i];
      const sentence = sentences[i] || '';

      if (shot?.selectedClip || (sentence && sentence.trim().length > 0)) {
        return true;
      }
    }
    return false;
  }

  // Draft mode: check draftStoryboard
  const beats = window.draftStoryboard?.beats || [];
  for (const beat of beats) {
    if (beat.selectedClip || (beat.text && beat.text.trim().length > 0)) {
      return true;
    }
  }
  return false;
}

function updateRenderArticleButtonState() {
  const renderBtn = document.getElementById('render-article-btn');
  if (!renderBtn) return;

  // Enable if session exists OR draft is dirty
  const hasSession = !!window.currentStorySessionId;
  const draftDirty = isStoryboardDirty();

  if (hasSession || draftDirty) {
    renderBtn.disabled = false;
    renderBtn.title = '';
  } else {
    renderBtn.disabled = true;
    renderBtn.title = 'Please add at least one clip or text to render';
  }
}

function handleEditBeatInline(textEl) {
  // Avoid starting multiple edits at once
  if (currentBeatEditing && currentBeatEditing.el !== textEl) {
    // Finish or cancel the other one first
    currentBeatEditing.el.blur();
  }

  const isDraft = textEl.dataset.draft === 'true';
  let currentText = '';
  let identifier = null;

  if (isDraft && !window.currentStorySessionId) {
    // Phase 1: Draft mode uses beatId
    const beatId = textEl.dataset.beatId;
    if (!beatId) {
      console.error('[article] Missing beatId in draft mode');
      return;
    }
    const beat = window.draftStoryboard?.beats?.find((b) => b.id === beatId);
    currentText = beat?.text ?? textEl.textContent ?? '';
    identifier = beatId;
  } else {
    // Session mode uses sentenceIndex
    const sentenceIndex = Number(textEl.dataset.sentenceIndex ?? -1);
    if (sentenceIndex < 0) return;
    const sentences = window.currentStorySession?.story?.sentences || [];
    currentText = sentences[sentenceIndex] ?? textEl.textContent ?? '';
    identifier = sentenceIndex;
  }

  currentBeatEditing = {
    el: textEl,
    identifier, // Phase 1: Can be beatId (string) or sentenceIndex (number)
    isDraft,
    originalText: currentText,
  };

  textEl.contentEditable = 'true';
  textEl.classList.add('beat-text-editing');
  textEl.focus();

  // Place caret at end
  const range = document.createRange();
  range.selectNodeContents(textEl);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  // Attach key handler once
  textEl.addEventListener('keydown', handleBeatTextKeydown);
  textEl.addEventListener('blur', handleBeatTextBlur);
}

async function commitBeatTextEdit() {
  if (!currentBeatEditing) return;

  const { el, identifier, isDraft, originalText } = currentBeatEditing;
  const newText = (el.textContent || '').trim();

  // Clean up editing state UI
  el.contentEditable = 'false';
  el.classList.remove('beat-text-editing');
  el.removeEventListener('keydown', handleBeatTextKeydown);
  el.removeEventListener('blur', handleBeatTextBlur);

  currentBeatEditing = null;

  if (!newText || newText === originalText) {
    // No change → nothing to do
    el.textContent = originalText;
    return;
  }

  // Draft mode: update draftStoryboard directly, no API call
  if (isDraft && !window.currentStorySessionId) {
    if (!window.draftStoryboard || !window.draftStoryboard.beats) {
      // Phase 1: Initialize with 1 empty beat if missing
      window.draftStoryboard = { beats: [{ id: generateBeatId(), text: '', selectedClip: null }] };
    }
    // Phase 1: Find beat by ID
    const beat = window.draftStoryboard.beats.find((b) => b.id === identifier);
    if (beat) {
      beat.text = newText;
    } else {
      console.error('[article] Beat not found:', identifier);
    }
    el.textContent = newText;
    updateRenderArticleButtonState();

    // Trigger debounced preview (behind feature flag)
    if (window.BEAT_PREVIEW_ENABLED) {
      const style = window.draftStoryboard?.captionStyle || {
        fontFamily: 'DejaVu Sans',
        weightCss: 'bold',
        fontPx: 48,
        yPct: 0.5,
        wPct: 0.8,
        opacity: 1,
        color: '#FFFFFF',
      };
      const m = window.__beatPreviewModule || (await window.__beatPreviewModulePromise);
      if (m) {
        m.generateBeatCaptionPreviewDebounced(identifier, newText, style);
      }
    }
    return;
  }

  // Session mode: use existing API flow
  try {
    const { apiFetch } = await import('/api.mjs');

    const resp = await apiFetch('/story/update-beat-text', {
      method: 'POST',
      body: {
        sessionId: window.currentStorySessionId,
        sentenceIndex: identifier, // Phase 1: identifier is sentenceIndex in session mode
        text: newText,
      },
    });

    if (!resp.success) {
      console.error('[article] Update beat failed:', resp);
      showError('article-error', resp.detail || 'Failed to update beat');
      // Revert text if backend failed
      el.textContent = originalText;
      return;
    }

    const { sentences, shots } = resp.data;

    // Keep session in sync
    if (!window.currentStorySession.story) {
      window.currentStorySession.story = {};
    }
    window.currentStorySession.story.sentences = sentences;
    window.currentStorySession.shots = shots;

    console.log(
      '[article] Update beat: sentenceIndex=%d, newText=%s',
      identifier,
      newText.slice(0, 80)
    );

    // Re-render storyboard from canonical data
    renderStoryboard(window.currentStorySession);
    updateRenderArticleButtonState();

    // Trigger debounced preview (behind feature flag) - schedule after DOM update
    if (window.BEAT_PREVIEW_ENABLED) {
      // explicitStyle: ONLY user/session overrides (empty object if none)
      const rawStyle =
        window.currentStorySession.overlayCaption || window.currentStorySession.captionStyle || {};
      requestAnimationFrame(async () => {
        const { extractStyleOnly } = await import('/js/caption-style-helper.js');
        const explicitStyle = extractStyleOnly(rawStyle);
        const m = window.__beatPreviewModule || (await window.__beatPreviewModulePromise);
        if (m) {
          m.generateBeatCaptionPreviewDebounced(identifier, newText, explicitStyle);
        }
      });
    }
  } catch (err) {
    console.error('[article] Update beat error:', err);
    showError('article-error', 'Could not update beat. Please try again.');
    el.textContent = originalText;
  }
}

function handleBeatTextKeydown(e) {
  if (!currentBeatEditing) return;

  if (e.key === 'Enter') {
    e.preventDefault();
    commitBeatTextEdit();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    // Cancel and revert
    const { el, originalText } = currentBeatEditing;
    el.textContent = originalText;
    el.blur(); // will trigger blur handler cleanup
  }
}

function handleBeatTextBlur(e) {
  // When focus leaves, commit the change
  commitBeatTextEdit();
}

function renderClipPickerGrid(shot, pageInfo = null) {
  const grid = document.getElementById('clip-picker-grid');
  if (!grid) return;

  // Remove existing sentinel if present
  const existingSentinel = document.getElementById('clip-picker-sentinel');
  if (existingSentinel) {
    existingSentinel.remove();
  }

  // Show all candidates from current page (backend returns 12 per page)
  const candidates = shot.candidates || [];

  if (candidates.length === 0) {
    grid.innerHTML =
      '<div class="text-sm text-gray-500 dark:text-gray-400 col-span-full text-center py-4">No clips found. Try a different search.</div>';
    // Hide pagination if no results
    const paginationBar = document.getElementById('clip-picker-pagination');
    if (paginationBar) {
      paginationBar.classList.add('hidden');
    }
    return;
  }

  grid.innerHTML = candidates
    .map((clip) => {
      const isSelected = shot.selectedClip?.id === clip.id;
      return `
                    <div
                        class="clip-option rounded overflow-hidden bg-gray-100 dark:bg-gray-800 border ${isSelected ? 'border-blue-500' : 'border-gray-300 dark:border-gray-700'} cursor-pointer hover:border-blue-500 transition"
                        data-clip-id="${clip.id}"
                    >
                        <video
                            class="w-full h-40 object-cover pointer-events-none"
                            src="${clip.url || ''}"
                            ${clip.thumbUrl ? `poster="${clip.thumbUrl}"` : ''}
                            playsinline
                            muted
                            preload="none"
                        ></video>
                        <div class="p-1 text-[11px] truncate text-gray-600 dark:text-gray-300">
                            ${clip.photographer || ''}
                        </div>
                    </div>
                `;
    })
    .join('');

  // Add sentinel element if there are more pages
  if (pageInfo && pageInfo.hasMore) {
    const sentinel = document.createElement('div');
    sentinel.id = 'clip-picker-sentinel';
    sentinel.className = 'h-4 w-full';
    grid.appendChild(sentinel);
  }

  // Update pagination controls
  updatePaginationControls(pageInfo);
}

function updatePaginationControls(pageInfo) {
  const paginationBar = document.getElementById('clip-picker-pagination');
  if (!paginationBar) return;

  if (!pageInfo) {
    paginationBar.classList.add('hidden');
    return;
  }

  const { currentPage, hasMore } = pageInfo;
  const prevBtn = document.getElementById('clip-picker-prev');
  const nextBtn = document.getElementById('clip-picker-more');

  // Show pagination bar
  paginationBar.classList.remove('hidden');

  // Update Previous button
  if (prevBtn) {
    if (currentPage === 1) {
      prevBtn.disabled = true;
      prevBtn.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
      prevBtn.disabled = false;
      prevBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
  }

  // Update More clips button
  if (nextBtn) {
    if (!hasMore) {
      nextBtn.disabled = true;
      nextBtn.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
      nextBtn.disabled = false;
      nextBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
  }
}

// Phase 1: Updated to accept beatId (string) for draft mode or sentenceIndex (number) for session mode
function openClipPicker(beatIdOrIndex, isDraft = null) {
  // Auto-detect draft mode if not specified
  if (isDraft === null) {
    isDraft = !window.currentStorySessionId;
  }

  if (isDraft) {
    // Phase 1: Draft mode uses beatId (string)
    window.clipPickerIsDraft = true;
    window.clipPickerBeatId = beatIdOrIndex; // Now expects string ID
    window.draftClipPickerPage = 1;
    window.draftClipPickerCandidates = [];

    // TEMP: Log for debugging
    console.log('[clip-picker][draft] open', { beatId: beatIdOrIndex });
  } else {
    // Session mode: use existing flow
    const session = window.currentStorySession;
    if (!session || !session.shots) {
      console.error('[article] No session or shots available');
      showError('article-error', 'Please prepare the storyboard first');
      return;
    }

    const shot = session.shots.find((s) => s.sentenceIndex === beatIdOrIndex);
    if (!shot) {
      console.error('[article] Shot not found for sentence index:', beatIdOrIndex);
      return;
    }

    window.clipPickerIsDraft = false;
    window.currentClipPickerSentence = beatIdOrIndex;

    // Initialize pagination state
    window.clipPickerPagination = { currentPage: 1, hasMore: false };
  }

  // Get picker elements
  const picker = document.getElementById('clip-picker');
  const searchInput = document.getElementById('clip-search-input');
  const closeBtn = document.getElementById('clip-picker-close');

  if (!picker) {
    console.error('[article] Clip picker element not found');
    return;
  }

  // Store target context on picker element (single source of truth)
  if (isDraft) {
    picker.dataset.targetKind = 'beat';
    picker.dataset.targetId = String(beatIdOrIndex);
  } else {
    picker.dataset.targetKind = 'sentence';
    picker.dataset.targetId = String(beatIdOrIndex);
  }

  // Clear search input
  if (searchInput) {
    searchInput.value = '';
  }

  // Render grid - draft or session mode
  if (window.clipPickerIsDraft) {
    // Phase 1: Draft mode: find beat by ID
    const beat = window.draftStoryboard?.beats?.find((b) => b.id === window.clipPickerBeatId);
    const fakeShot = {
      candidates: window.draftClipPickerCandidates || [],
      selectedClip: beat?.selectedClip || null,
    };
    renderClipPickerGrid(fakeShot, {
      currentPage: window.draftClipPickerPage || 1,
      hasMore: false,
    });
  } else {
    // Session mode: use existing shot
    const shot = window.currentStorySession.shots.find((s) => s.sentenceIndex === beatIdOrIndex);
    renderClipPickerGrid(shot, window.clipPickerPagination);

    // Trigger initial search to get pagination metadata (hasMore)
    if (shot && shot.searchQuery && shot.searchQuery.trim()) {
      runClipSearch(1, { append: false });
    } else {
      // Even without initial search, setup observer if sentinel exists
      if (document.getElementById('clip-picker-sentinel')) {
        setupClipPickerInfiniteScroll();
      }
    }
  }

  // Show picker
  picker.classList.remove('hidden');

  // Setup close button
  if (closeBtn) {
    closeBtn.onclick = () => {
      // Clean up infinite scroll observer
      if (window.clipPickerInfinite?.observer) {
        window.clipPickerInfinite.observer.disconnect();
        window.clipPickerInfinite.observer = null;
      }
      picker.classList.add('hidden');
      window.currentClipPickerSentence = null;
      window.clipPickerIsDraft = false;
      window.clipPickerBeatId = null; // Phase 1: Clear beatId instead of sentenceIndex
      // Clear dataset
      delete picker.dataset.targetKind;
      delete picker.dataset.targetId;
      // Remove click handler when picker is closed
      picker.removeEventListener('click', handleClipOptionClick);
    };
  }

  // Setup hover interactions (delegated on drawer)
  setupClipPickerHover();

  // Setup click handler on drawer (not grid) for clip selection
  // (picker already declared above at line 6071)
  if (picker) {
    picker.removeEventListener('click', handleClipOptionClick);
    picker.addEventListener('click', handleClipOptionClick);
  }

  // Setup search button and Enter key
  const searchBtn = document.getElementById('clip-search-btn');
  // (searchInput already declared above at line 6072)

  if (searchBtn) {
    searchBtn.onclick = () => {
      if (window.clipPickerIsDraft) {
        window.draftClipPickerPage = 1;
        runDraftClipSearch(1, { append: false });
      } else {
        // Reset to page 1 for new search
        if (window.clipPickerPagination) {
          window.clipPickerPagination.currentPage = 1;
        }
        runClipSearch(1, { append: false });
      }
    };
  }

  if (searchInput) {
    searchInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (window.clipPickerIsDraft) {
          window.draftClipPickerPage = 1;
          runDraftClipSearch(1, { append: false });
        } else {
          // Reset to page 1 for new search
          if (window.clipPickerPagination) {
            window.clipPickerPagination.currentPage = 1;
          }
          runClipSearch(1, { append: false });
        }
      }
    };
  }

  // Setup pagination buttons
  const prevBtn = document.getElementById('clip-picker-prev');
  const nextBtn = document.getElementById('clip-picker-more');

  if (prevBtn) {
    prevBtn.onclick = () => {
      if (window.clipPickerIsDraft) {
        if (window.draftClipPickerPage > 1) {
          window.draftClipPickerPage--;
          runDraftClipSearch(window.draftClipPickerPage);
        }
      } else {
        if (window.clipPickerPagination && window.clipPickerPagination.currentPage > 1) {
          window.clipPickerPagination.currentPage--;
          runClipSearch(window.clipPickerPagination.currentPage);
        }
      }
    };
  }

  if (nextBtn) {
    nextBtn.onclick = () => {
      if (window.clipPickerIsDraft) {
        const nextPage = (window.draftClipPickerPage || 1) + 1;
        runDraftClipSearch(nextPage, { append: true });
      } else {
        if (window.clipPickerPagination && window.clipPickerPagination.hasMore) {
          const nextPage = window.clipPickerPagination.currentPage + 1;
          runClipSearch(nextPage, { append: true });
        }
      }
    };
  }
}

function setupClipPickerHover() {
  const picker = document.getElementById('clip-picker');
  if (!picker) return;

  // Robustness guard: prevent double-binding
  const grid = document.getElementById('clip-picker-grid');
  if (grid?.dataset?.hoverBound === '1') return;
  if (grid) grid.dataset.hoverBound = '1';

  // Check hover capability (desktop only)
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (!canHover) return;

  // Remove existing listeners to avoid duplicates
  picker.removeEventListener('mouseenter', handleClipPickerMouseEnter, true);
  picker.removeEventListener('mouseleave', handleClipPickerMouseLeave, true);

  picker.addEventListener('mouseenter', handleClipPickerMouseEnter, true);
  picker.addEventListener('mouseleave', handleClipPickerMouseLeave, true);
}

function handleClipPickerMouseEnter(e) {
  const card = e.target.closest('.clip-option');
  if (!card) return;
  const video = card.querySelector('video');
  if (!video) return;
  video.play().catch(() => {});
}

function handleClipPickerMouseLeave(e) {
  const card = e.target.closest('.clip-option');
  if (!card) return;
  const video = card.querySelector('video');
  if (!video) return;
  video.pause();
  video.currentTime = 0;
}

function setClipPickerBusy(busy) {
  const drawer = document.getElementById('clip-picker');
  if (!drawer) return;
  drawer.dataset.busy = busy ? '1' : '0';

  // Exclude pagination buttons - they are managed exclusively by updatePaginationControls
  const buttons = drawer.querySelectorAll(
    'button:not(#clip-picker-prev):not(#clip-picker-more), .clip-option'
  );
  buttons.forEach((el) => {
    el.toggleAttribute('disabled', busy);
    if (busy) {
      el.classList.add('opacity-60', 'pointer-events-none');
    } else {
      el.classList.remove('opacity-60', 'pointer-events-none');
    }
  });
}

function setupClipPickerInfiniteScroll() {
  const grid = document.getElementById('clip-picker-grid');
  const sentinel = document.getElementById('clip-picker-sentinel');
  const drawer = document.getElementById('clip-picker');
  if (!grid || !sentinel || !drawer) return;

  // Clean up any old observer
  if (window.clipPickerInfinite?.observer) {
    window.clipPickerInfinite.observer.disconnect();
  }

  const state =
    window.clipPickerInfinite ||
    (window.clipPickerInfinite = { loadingNext: false, observer: null });

  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (!entry.isIntersecting) return;

      const busy = drawer.dataset.busy === '1';
      const pagination = window.clipPickerPagination || { currentPage: 1, hasMore: false };
      if (busy || state.loadingNext || !pagination.hasMore) return;

      state.loadingNext = true;
      const nextPage = (pagination.currentPage || 1) + 1;
      console.log('[clip-picker] infinite scroll → loading page', nextPage);
      runClipSearch(nextPage, { append: true }).finally(() => {
        state.loadingNext = false;
      });
    },
    {
      root: grid,
      rootMargin: '0px 0px 200px 0px',
      threshold: 0.1,
    }
  );

  observer.observe(sentinel);
  state.observer = observer;
}

async function handleClipOptionClick(e) {
  // Only handle clicks when picker is visible
  const picker = document.getElementById('clip-picker');
  if (!picker || picker.classList.contains('hidden')) {
    return;
  }

  const card = e.target.closest('.clip-option[data-clip-id]');
  if (!card) return;

  // Stop propagation to prevent interfering with other click handlers
  e.stopPropagation();

  const clipId = card.getAttribute('data-clip-id');
  const isDraft = window.clipPickerIsDraft;

  if (!clipId) {
    console.error('[article] Missing clipId');
    return;
  }

  // Read target context from picker dataset (with fallback to legacy globals)
  const kind = picker?.dataset?.targetKind;
  const id = picker?.dataset?.targetId;

  // Optional debug log
  if (window.__clipPickerDebug) {
    console.log('[clip-picker] target', kind, id);
  }

  // Draft mode: update draftStoryboard directly, no API call
  if (isDraft) {
    // Phase 1: Use beatId instead of sentenceIndex
    // Prefer dataset, fallback to legacy global
    const beatId = kind === 'beat' && id ? id : window.clipPickerBeatId;
    if (!beatId) {
      console.error('[clip-picker][draft] Missing beatId in draft mode');
      return;
    }

    // Find clip from candidates
    const clip = window.draftClipPickerCandidates?.find((c) => c.id === clipId);
    if (!clip) {
      console.error('[article] Clip not found in draft candidates');
      return;
    }

    // TEMP: Log for debugging
    console.log('[clip-picker][draft] select', { beatId, clipId: clip?.id });

    // Update draftStoryboard
    if (!window.draftStoryboard || !window.draftStoryboard.beats) {
      // Phase 1: Initialize with 1 empty beat if missing
      window.draftStoryboard = { beats: [{ id: generateBeatId(), text: '', selectedClip: null }] };
    }
    // Phase 1: Find beat by ID
    const beat = window.draftStoryboard.beats.find((b) => b.id === beatId);
    if (!beat) {
      console.error('[clip-picker][draft] Beat not found:', beatId);
      return;
    }

    // Update beat with selected clip
    beat.selectedClip = clip;

    // Re-render draft storyboard immediately to show the change
    renderDraftStoryboard();

    // Close picker
    picker.classList.add('hidden');
    window.clipPickerIsDraft = false;
    window.clipPickerBeatId = null; // Phase 1: Clear beatId
    // Clear dataset
    delete picker.dataset.targetKind;
    delete picker.dataset.targetId;

    // Update render button state
    updateRenderArticleButtonState();
    return;
  }

  // Session mode: use existing API flow
  const sessionId = window.currentStorySessionId;
  if (!sessionId) {
    showError('article-error', 'Session not found');
    return;
  }

  // Read sentenceIndex from dataset (with fallback to legacy global)
  let sentenceIndex;
  if (kind === 'sentence' && id) {
    sentenceIndex = Number(id);
  } else {
    // Fallback to legacy global
    sentenceIndex = window.currentClipPickerSentence;
  }

  if (sentenceIndex === undefined || sentenceIndex === null || isNaN(sentenceIndex)) {
    console.error('[clip-picker] Invalid sentenceIndex context');
    showError('article-error', 'Invalid clip selection context');
    return;
  }

  try {
    setClipPickerBusy(true);

    const { apiFetch } = await import('/api.mjs');

    // Call API to update selected clip
    const resp = await apiFetch('/story/update-shot', {
      method: 'POST',
      body: {
        sessionId: sessionId,
        sentenceIndex: sentenceIndex,
        clipId: clipId,
      },
    });

    if (!resp.success) {
      throw new Error(resp.error || 'Failed to update clip');
    }

    // Update local session
    const updatedShot = resp.data.shots?.find((s) => s.sentenceIndex === sentenceIndex);
    if (updatedShot && window.currentStorySession && window.currentStorySession.shots) {
      const idx = window.currentStorySession.shots.findIndex(
        (s) => s.sentenceIndex === sentenceIndex
      );
      if (idx !== -1) {
        window.currentStorySession.shots[idx] = updatedShot;
      }
    }

    // Update storyboard card
    if (updatedShot) {
      updateStoryboardCardForSentence(updatedShot);
    }

    // Close picker
    // (picker already declared above at line 6179)
    if (picker) {
      picker.classList.add('hidden');
      // Clear dataset
      delete picker.dataset.targetKind;
      delete picker.dataset.targetId;
    }

    // Update render button state
    updateRenderArticleButtonState();
    window.currentClipPickerSentence = null;

    console.log('[article] Clip swapped successfully');
  } catch (error) {
    console.error('[article] Swap clip failed:', error);
    showError('article-error', error.message || 'Failed to swap clip');
  } finally {
    setClipPickerBusy(false);
  }
}

function updateStoryboardCardForSentence(shot) {
  if (!shot || !shot.selectedClip) return;

  const card = document.querySelector(
    `#storyboard-row [data-sentence-index="${shot.sentenceIndex}"]`
  );
  if (!card) return;

  const video = card.querySelector('video');
  if (!video) return;

  const clip = shot.selectedClip;
  video.src = clip.url || '';
  if (clip.thumbUrl) {
    video.setAttribute('poster', clip.thumbUrl);
  } else {
    video.removeAttribute('poster');
  }
  video.load();
}

async function runClipSearch(pageOverride = null, options = {}) {
  const { append = false } = options;
  const input = document.getElementById('clip-search-input');
  const query = input?.value.trim() || '';
  const sentenceIndex = window.currentClipPickerSentence;

  if (sentenceIndex === undefined || sentenceIndex === null) {
    console.error('[article] No sentence index for search');
    return;
  }

  const sessionId = window.currentStorySessionId;
  if (!sessionId) {
    showError('article-error', 'Session not found');
    return;
  }

  // Initialize pagination state if not exists
  if (!window.clipPickerPagination) {
    window.clipPickerPagination = { currentPage: 1, hasMore: false, lastQuery: null };
  }

  // Reset to page 1 if query changed (new search) - but only if not appending
  const lastQuery = window.clipPickerPagination.lastQuery;
  if (!append && lastQuery !== null && lastQuery !== query) {
    window.clipPickerPagination.currentPage = 1;
    window.clipPickerPagination.hasMore = false;
  }
  window.clipPickerPagination.lastQuery = query;

  // Use override page if provided, otherwise use current page
  const currentPage =
    pageOverride !== null ? pageOverride : window.clipPickerPagination.currentPage;

  // If appending, save existing candidates before API call
  let existingCandidates = [];
  if (append && window.currentStorySession && window.currentStorySession.shots) {
    const existingShot = window.currentStorySession.shots.find(
      (s) => s.sentenceIndex === sentenceIndex
    );
    if (existingShot && existingShot.candidates) {
      existingCandidates = existingShot.candidates;
    }
  }

  try {
    setClipPickerBusy(true);

    const { apiFetch } = await import('/api.mjs');

    const resp = await apiFetch('/story/search-shot', {
      method: 'POST',
      body: {
        sessionId: sessionId,
        sentenceIndex: sentenceIndex,
        query: query, // can be empty = use original sentence
        page: currentPage,
      },
    });

    if (!resp.success) {
      throw new Error(resp.error || 'Search failed');
    }

    const shot = resp.data.shot;
    const page = resp.data.page || currentPage;
    const hasMore = resp.data.hasMore || false;

    // If append mode, merge new candidates with existing ones (dedupe by id)
    if (append && existingCandidates.length > 0) {
      const existingIds = new Set(existingCandidates.map((c) => c.id).filter((id) => id != null));
      const newCandidates = (shot.candidates || []).filter(
        (c) => c.id == null || !existingIds.has(c.id)
      );
      shot.candidates = [...existingCandidates, ...newCandidates];
    }

    // Update pagination state
    window.clipPickerPagination.currentPage = page;
    window.clipPickerPagination.hasMore = hasMore;

    // Log pagination state for debugging
    console.log(`[clip-picker] page=${page} hasMore=${hasMore} append=${append}`);

    // Update session model
    if (window.currentStorySession && window.currentStorySession.shots) {
      const idx = window.currentStorySession.shots.findIndex(
        (s) => s.sentenceIndex === shot.sentenceIndex
      );
      if (idx !== -1) {
        window.currentStorySession.shots[idx] = shot;
      }
    }

    // Re-render candidate grid with pagination info
    renderClipPickerGrid(shot, window.clipPickerPagination);

    // Update pagination controls after rendering
    updatePaginationControls(window.clipPickerPagination);

    // Re-setup infinite scroll observer if sentinel exists (it may have been removed/re-added)
    if (document.getElementById('clip-picker-sentinel')) {
      setupClipPickerInfiniteScroll();
    }
  } catch (error) {
    console.error('[article] Search failed:', error);
    showError('article-error', error.message || 'Could not search clips. Please try again.');
  } finally {
    setClipPickerBusy(false);
  }
}

async function runDraftClipSearch(pageOverride = null, options = {}) {
  const { append = false } = options;
  const input = document.getElementById('clip-search-input');
  const query = input?.value.trim() || '';
  // Phase 1: Use beatId instead of sentenceIndex
  const beatId = window.clipPickerBeatId;

  if (!beatId) {
    console.error('[article] No beatId for draft search');
    return;
  }

  // Use override page if provided, otherwise use current page
  const currentPage = pageOverride !== null ? pageOverride : window.draftClipPickerPage || 1;
  window.draftClipPickerPage = currentPage;

  // If appending, save existing candidates before API call
  let existingCandidates = [];
  if (append && window.draftClipPickerCandidates) {
    existingCandidates = window.draftClipPickerCandidates;
  }

  try {
    setClipPickerBusy(true);

    const { apiFetch } = await import('/api.mjs');

    // Use /api/assets/options for draft mode (session-free)
    const resp = await apiFetch('/assets/options', {
      method: 'POST',
      body: {
        type: 'videos',
        query:
          query || (window.draftStoryboard?.beats?.find((b) => b.id === beatId)?.text || '').trim(),
        page: currentPage,
        perPage: 12,
      },
    });

    // Robust check: handle both { ok: true } (success) and { success: false } (error) response shapes
    const ok = resp?.ok ?? resp?.success;
    if (!ok) {
      throw new Error(resp?.error || resp?.reason || resp?.message || 'Search failed');
    }

    // Temporary diagnostic log (gated)
    if (window.__DEBUG_DRAFT_SEARCH) {
      console.log('[draft-search] Response:', {
        ok: resp?.ok,
        itemsCount: resp?.data?.items?.length || 0,
        nextPage: resp?.data?.nextPage ?? null,
      });
    }

    // Map response to candidate shape expected by renderClipPickerGrid
    const candidates = (resp.data.items || []).map((item) => ({
      id: item.id,
      url: item.fileUrl, // CRITICAL: renderClipPickerGrid expects 'url', not 'fileUrl'
      thumbUrl: item.thumbUrl,
      photographer: item.photographer || '',
      duration: item.duration,
      width: item.width,
      height: item.height,
      sourceUrl: item.sourceUrl,
      provider: item.provider || 'pexels',
    }));

    // Map pagination
    const pageInfo = {
      currentPage: currentPage,
      hasMore: resp.data.nextPage !== null,
    };

    // If append mode, merge new candidates with existing ones (dedupe by id)
    let finalCandidates = candidates;
    if (append && existingCandidates.length > 0) {
      const existingIds = new Set(existingCandidates.map((c) => c.id).filter((id) => id != null));
      const newCandidates = candidates.filter((c) => c.id == null || !existingIds.has(c.id));
      finalCandidates = [...existingCandidates, ...newCandidates];
    }

    // Store candidates
    window.draftClipPickerCandidates = finalCandidates;

    // Phase 1: Get current beat by ID
    const beat = window.draftStoryboard?.beats?.find((b) => b.id === beatId);
    const fakeShot = {
      candidates: finalCandidates,
      selectedClip: beat?.selectedClip || null,
    };

    // Re-render candidate grid with pagination info
    renderClipPickerGrid(fakeShot, pageInfo);

    // Update pagination controls after rendering
    updatePaginationControls(pageInfo);
  } catch (error) {
    console.error('[article] Draft search failed:', error);
    showError('article-error', error.message || 'Could not search clips. Please try again.');
  } finally {
    setClipPickerBusy(false);
  }
}

function setupStoryboardHover() {
  // Idempotent guard: prevent duplicate listener binding
  if (window.__beatBalloonHoverBound === true) return;
  window.__beatBalloonHoverBound = true;

  const storyboardRow = document.getElementById('storyboard-row');
  const storyboardEl = document.getElementById('storyboard');
  if (!storyboardRow) return;

  // Check hover capability (desktop only)
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (!canHover) return;

  // Track currently hovered card for cleanup
  let activeHoveredCard = null;

  // Cleanup function: remove all hover and squish classes from a card
  function cleanupCardState(card) {
    if (!card) return;
    card.classList.remove(
      'beat-hovered',
      'squish-left-1',
      'squish-left-2',
      'squish-right-1',
      'squish-right-2'
    );
    const video = card.querySelector('.storyboard-video');
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    storyboardEl?.classList.remove('storyboard-hovering');
  }

  // Cleanup all cards: remove all squish classes from all cards
  function cleanupAllSquish() {
    const allCards = storyboardRow.querySelectorAll('[data-beat-id], [data-sentence-index]');
    allCards.forEach((card) => {
      card.classList.remove('squish-left-1', 'squish-left-2', 'squish-right-1', 'squish-right-2');
    });
  }

  // Apply hover state to a card and squish neighbors
  function applyHoverState(card) {
    if (activeHoveredCard === card) return; // Already hovering this card

    // Clean up previous hovered card if switching
    if (activeHoveredCard && activeHoveredCard !== card) {
      cleanupCardState(activeHoveredCard);
    }

    // Clean up all squish classes first to prevent collisions
    cleanupAllSquish();

    // Get all beat cards (exclude add-beat buttons)
    const allCards = Array.from(
      storyboardRow.querySelectorAll('[data-beat-id], [data-sentence-index]')
    );
    const hoveredIndex = allCards.indexOf(card);

    if (hoveredIndex === -1) return;

    // Apply hover class to current card
    card.classList.add('beat-hovered');

    // Add hover class to storyboard wrapper for extra padding
    storyboardEl?.classList.add('storyboard-hovering');

    // Apply squish classes to neighbors (with bounds checking)
    if (hoveredIndex > 0) {
      allCards[hoveredIndex - 1].classList.add('squish-right-1');
    }
    if (hoveredIndex > 1) {
      allCards[hoveredIndex - 2].classList.add('squish-right-2');
    }
    if (hoveredIndex < allCards.length - 1) {
      allCards[hoveredIndex + 1].classList.add('squish-left-1');
    }
    if (hoveredIndex < allCards.length - 2) {
      allCards[hoveredIndex + 2].classList.add('squish-left-2');
    }

    // Start video playback
    const video = card.querySelector('.storyboard-video');
    if (video) {
      video.play().catch((e) => console.warn('[article] Video play failed:', e));
    }

    activeHoveredCard = card;
  }

  // Handle pointerover (entering card area)
  function handleCardHover(e) {
    // Find the card container
    const card = e.target.closest('[data-beat-id], [data-sentence-index]');
    if (!card) return;

    // Exclude interactive elements
    if (e.target.closest('button, .beat-text, [contenteditable="true"]')) return;

    // Guard against internal child transitions
    if (e.relatedTarget && card.contains(e.relatedTarget)) return;

    applyHoverState(card);
  }

  // Handle pointerout (leaving card area)
  function handleCardLeave(e) {
    const card = e.target.closest('[data-beat-id], [data-sentence-index]');
    if (!card) return;

    // Guard: if moving to child within same card, don't leave
    if (e.relatedTarget && card.contains(e.relatedTarget)) return;

    // Clean up this card's hover state
    cleanupCardState(card);
    cleanupAllSquish();

    // Ensure hover class is removed
    storyboardEl?.classList.remove('storyboard-hovering');

    if (activeHoveredCard === card) {
      activeHoveredCard = null;
    }
  }

  // Use event delegation with pointerover/pointerout (they bubble, unlike mouseenter/mouseleave)
  storyboardRow.addEventListener('pointerover', handleCardHover, true);
  storyboardRow.addEventListener('pointerout', handleCardLeave, true);
}

// ========================================
// Render Status Banner Management
// ========================================
// Shows a 3-step progress banner during /api/story/finalize execution:
// - Immediately: "Preparing video..."
// - After 3s: "Adding speech..."
// - After 6s: "Finalizing video..."
//
// To modify timing or messages, update:
// - showRenderStatus() timeout values (3000ms, 6000ms)
// - Status text strings in showRenderStatus()
// - Banner HTML element (#render-status-banner) near end of body
// ========================================

let renderStatusTimeouts = [];
let renderStatusActive = false;

function showRenderStatus() {
  // Clear any existing timeouts
  hideRenderStatus();

  const banner = document.getElementById('render-status-banner');
  const textEl = document.getElementById('render-status-text');

  if (!banner || !textEl) {
    console.warn('[render-status] Banner elements not found');
    return;
  }

  renderStatusActive = true;

  // Show banner and set initial text
  banner.classList.remove('hidden');
  textEl.textContent = 'Preparing video...';

  // After 3 seconds, change to "Adding speech..."
  const timeout1 = setTimeout(() => {
    if (renderStatusActive && textEl) {
      textEl.textContent = 'Adding speech...';
    }
  }, 3000);
  renderStatusTimeouts.push(timeout1);

  // After 6 seconds, change to "Finalizing video..."
  const timeout2 = setTimeout(() => {
    if (renderStatusActive && textEl) {
      textEl.textContent = 'Finalizing video...';
    }
  }, 6000);
  renderStatusTimeouts.push(timeout2);
}

function hideRenderStatus() {
  renderStatusActive = false;

  // Clear all timeouts
  renderStatusTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
  renderStatusTimeouts = [];

  // Hide banner
  const banner = document.getElementById('render-status-banner');
  if (banner) {
    banner.classList.add('hidden');
  }

  // Reset text
  const textEl = document.getElementById('render-status-text');
  if (textEl) {
    textEl.textContent = 'Preparing video...';
  }
}

async function ensureSessionFromDraft() {
  // Validate draft is dirty (before any API calls or UI changes)
  if (!isStoryboardDirty()) {
    throw new Error('Please add at least one clip or text to render');
  }

  // Filter valid beats early (before any API calls)
  const validBeats = window.draftStoryboard.beats.filter(isValidBeat);

  if (validBeats.length === 0) {
    throw new Error(
      "Add text + a clip to at least one beat to render. (Clip-only beats aren't supported yet.)"
    );
  }

  // Pure session creation - NO UI mutations
  const { apiFetch } = await import('/api.mjs');

  // Call backend to create session from draft (only valid beats)
  const resp = await apiFetch('/story/create-manual-session', {
    method: 'POST',
    body: {
      beats: validBeats.map((b) => ({
        text: b.text || '',
        selectedClip: b.selectedClip || null,
      })),
    },
  });

  if (!resp.success) {
    throw new Error(resp.error || resp.detail || 'Failed to create session');
  }

  const { sessionId, session } = resp.data;

  // Preserve client caption overrides if server doesn't have them
  const prev = window.currentStorySession;
  preserveCaptionOverrides(session, prev);

  // Set globals
  window.currentStorySessionId = sessionId;
  window.currentStorySession = session;

  // Replace draft UI with session UI
  await renderStoryboard(session);

  // Clear draft state (session is now source of truth)
  // Phase 1: Reset to 1 empty beat
  window.draftStoryboard = { beats: [{ id: generateBeatId(), text: '', selectedClip: null }] };

  return sessionId;
}

async function renderArticle() {
  const errorEl = document.getElementById('article-error');
  const renderBtn = document.getElementById('render-article-btn');
  const originalText = renderBtn?.textContent || 'Render video';
  const voicePresetEl = document.getElementById('article-voice-preset');
  const resultDiv = document.getElementById('article-render-result');
  const videoEl = document.getElementById('article-render-video');
  const videoUrlEl = document.getElementById('article-video-url');

  try {
    // Set loading state INSIDE try (ensures finally always runs)
    setLoading('render-article-btn', true);
    hideError('article-error');

    // Manual-first render: auto-create session from draft if no sessionId exists
    if (!window.currentStorySessionId) {
      try {
        await ensureSessionFromDraft();
      } catch (error) {
        // Ensure no partial session state
        window.currentStorySessionId = null;
        window.currentStorySession = null;

        showBlockingError(
          "Can't render yet",
          error?.message || 'Please complete at least one beat before rendering.'
        );
        return; // Exit early, but finally will still run
      }
    }

    showRenderStatus();
    const voicePreset = voicePresetEl?.value || 'male_calm';

    const { apiFetch } = await import('/api.mjs');

    // Call finalize with voice preset
    const finalizeResp = await apiFetch('/story/finalize', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': window.currentStorySessionId },
      body: {
        sessionId: window.currentStorySessionId,
        options: {
          voicePreset: voicePreset,
        },
      },
    });

    if (!finalizeResp.success) {
      if (finalizeResp.error === 'AUTH_REQUIRED') {
        showAuthRequiredModal();
        return;
      }
      if (finalizeResp.error === 'FREE_LIMIT_REACHED') {
        showFreeLimitModal();
        return;
      }
      throw new Error(
        finalizeResp.error ||
          finalizeResp.message ||
          finalizeResp.detail ||
          'Failed to finalize story'
      );
    }

    const session = finalizeResp.data;

    // Check if video is already ready
    if (session.finalVideo?.url) {
      // Render complete immediately!
      if (videoEl) {
        videoEl.src = session.finalVideo.url;
      }
      if (videoUrlEl) {
        videoUrlEl.href = session.finalVideo.url;
      }
      if (resultDiv) {
        resultDiv.classList.remove('hidden');
      }
      console.log('[article] Render complete:', session.finalVideo.url);

      // Redirect to My Shorts after brief preview
      const jobId = session.finalVideo?.jobId;
      if (jobId) {
        setTimeout(() => {
          window.location.assign(`/my-shorts.html?id=${encodeURIComponent(jobId)}`);
        }, 800);
      } else {
        // Fallback: try to extract from URL path
        const urlMatch = session.finalVideo?.url?.match(/artifacts\/[^/]+\/([^/]+)\//);
        if (urlMatch) {
          setTimeout(() => {
            window.location.assign(`/my-shorts.html?id=${encodeURIComponent(urlMatch[1])}`);
          }, 800);
        }
      }
    } else {
      // Poll for completion (similar to oneClickShortFromLink)
      const sessionId = window.currentStorySessionId;
      let attempts = 0;
      const maxAttempts = 60; // 5 minutes max

      while (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 5000)); // Poll every 5 seconds

        const statusResp = await apiFetch(`/story/${sessionId}`, {
          method: 'GET',
        });

        if (!statusResp.success || !statusResp.data) {
          throw new Error('Failed to check render status');
        }

        const polledSession = statusResp.data;

        if (polledSession.finalVideo?.url) {
          // Render complete!
          if (videoEl) {
            videoEl.src = polledSession.finalVideo.url;
          }
          if (videoUrlEl) {
            videoUrlEl.href = polledSession.finalVideo.url;
          }
          if (resultDiv) {
            resultDiv.classList.remove('hidden');
          }

          console.log('[article] Render complete:', polledSession.finalVideo.url);

          // Redirect to My Shorts after brief preview
          const jobId = polledSession.finalVideo?.jobId;
          if (jobId) {
            setTimeout(() => {
              window.location.assign(`/my-shorts.html?id=${encodeURIComponent(jobId)}`);
            }, 800);
          } else {
            // Fallback: try to extract from URL path
            const urlMatch = polledSession.finalVideo?.url?.match(/artifacts\/[^/]+\/([^/]+)\//);
            if (urlMatch) {
              setTimeout(() => {
                window.location.assign(`/my-shorts.html?id=${encodeURIComponent(urlMatch[1])}`);
              }, 800);
            }
          }
          break;
        }

        attempts++;
      }

      if (attempts >= maxAttempts) {
        throw new Error('Render timed out - please try again');
      }
    }
  } catch (error) {
    console.error('[article] Render failed:', error);
    showError('article-error', error.message || 'Failed to render video');
  } finally {
    // ALWAYS restore button state (runs even on early returns)
    // Order matters: setLoading(false) first, then restore text, then restore disabled state
    hideRenderStatus();
    setLoading('render-article-btn', false);

    if (renderBtn) {
      renderBtn.textContent = originalText;
    }

    // Use centralized button state function (handles disabled state intelligently)
    if (typeof updateRenderArticleButtonState === 'function') {
      updateRenderArticleButtonState();
    }
  }
}

// Initialize script preview input handler
(function () {
  const scriptPreviewEl = document.getElementById('article-script-preview');
  if (scriptPreviewEl) {
    let debounceTimer = null;
    scriptPreviewEl.addEventListener('input', () => {
      // Guard: Skip if syncing programmatically (prevents scriptSource flip)
      if (window._syncingTextarea) {
        return;
      }

      // Phase 2: Track raw draft state (only in raw mode)
      if (currentViewMode === 'raw') {
        window.rawDraftText = scriptPreviewEl.value;
        window.rawDirty = true;
      }

      // Debounce updates
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        updateScriptCounters();
        window.scriptSource = 'manual';

        // If in beat view, re-render to reflect textarea changes
        if (currentViewMode === 'beats') {
          renderBeatEditor();
        }
      }, 300);
    });

    // Update counters on page load if textarea has content
    if (scriptPreviewEl.value.trim()) {
      updateScriptCounters();
    }

    // Phase 2: Initialize raw draft state
    window.rawDraftText = scriptPreviewEl.value;
    window.rawDirty = false;
  }
})();

// Expose to window scope for ui-actions.js
window.summarizeArticle = summarizeArticle;
window.renderArticle = renderArticle;
window.prepareStoryboard = prepareStoryboard;

// Remix quote function
async function remixQuote(mode) {
  // [STUDIO] Block remix if legacy studio is disabled
  if (!ENABLE_LEGACY_STUDIO) {
    showError('quote-error', 'Legacy quote remix is disabled. Use Article Explainer instead.');
    return;
  }
  showError('quote-error', 'Quote remix is temporarily unavailable in this build.');
  try {
    showToast('Quote remix is temporarily unavailable in this build.');
  } catch {}
}

// Expose to window scope for ui-actions.js
window.remixQuote = remixQuote;

// AI Image generation
async function generateAiImage() {
  if (!window.auth?.currentUser) {
    showError('ai-error', 'Please log in to generate AI images');
    return;
  }

  // Check if user has sufficient credits (20 credits for AI generation)
  if (window.currentCredits < 20) {
    showError(
      'ai-error',
      'You need 20 credits to generate AI images. You have insufficient credits.'
    );
    return;
  }

  const prompt = document.getElementById('ai-prompt').value;
  const styleSlider = document.getElementById('ai-style-slider').value;

  if (!prompt.trim()) {
    showError('ai-error', 'Please enter a prompt');
    return;
  }

  setLoading('generate-ai-btn', true);
  hideError('ai-error');

  try {
    const { apiFetch } = await import('/api.mjs');

    // Map slider value to style: 0-0.5 = realistic, 0.5-1 = cartoon
    const style = parseFloat(styleSlider) <= 0.5 ? 'realistic' : 'cartoon';

    // Map slider 0..1 → ideogram style_type: closer to Realistic at 0, Creative at 1
    const creative = parseFloat(styleSlider);
    const styleType = creative < 0.33 ? 'Photographic' : creative > 0.66 ? 'Illustration' : 'None';

    const data = await apiFetch('/generate', {
      method: 'POST',
      body: {
        prompt,
        style, // retained for compatibility
        count: 1,
        // ideogram params ride along; backend adapter maps them
        params: { style_type: styleType },
        options: {},
      },
    });

    if (data?.ok === true && data?.data?.images) {
      // Handle successful generation
      const imgs = data.data.images || [];
      const first = imgs[0];
      const url = typeof first === 'string' ? first : first?.url || first;
      if (url) {
        // Update credits display if successful (20 credits deducted by backend)
        window.currentCredits -= 20;
        if (window.updateCreditsDisplay) {
          window.updateCreditsDisplay(window.currentCredits);
        }

        const aiAsset = {
          id: `ai-${Date.now()}`,
          fileUrl: url,
          thumbUrl: url,
          width: 1080,
          height: 1920,
          query: prompt,
          provider: 'ai',
          type: 'ai-generated',
        };
        // Add to asset grid
        const grid = document.getElementById('asset-grid');
        const assetElement = createAssetElement(aiAsset);
        grid.insertBefore(assetElement, grid.firstChild);
        // Also show next to remix references if present
        const aiBlock = document.getElementById('ai-result-block');
        const aiPrev = document.getElementById('ai-result-preview');
        if (aiBlock && aiPrev) {
          aiPrev.innerHTML = `<img src="${aiAsset.thumbUrl}" class="w-full h-full object-cover" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.src='/img/placeholder.svg'" />`;
          aiBlock.classList.remove('hidden');
        }
        // Auto-select the generated image
        selectAsset(aiAsset);
      } else {
        showError('ai-error', 'No image URL returned');
      }
    } else {
      // Some backends use { ok:false, reason } envelope
      showError('ai-error', (data && (data.reason || data.error)) || 'Failed to generate AI image');
    }
  } catch (error) {
    if (error?.reason === 'INSUFFICIENT_CREDITS') {
      showError(
        'ai-error',
        'You need 20 credits to generate AI images. You have insufficient credits.'
      );
    } else {
      showError('ai-error', error.message || 'Network error');
    }
  } finally {
    setLoading('generate-ai-btn', false);
  }
}

// Remix button handler: require at least 1 reference, prefer 2
document.addEventListener('click', (e) => {
  const t = e.target;
  if (!t || t.id !== 'remix-generate-btn') return;
  e.preventDefault();

  // [STUDIO] Block AI image generation if legacy studio is disabled
  if (!ENABLE_LEGACY_STUDIO) {
    showError('ai-error', 'Legacy AI image generation is disabled. Use Article Explainer instead.');
    return;
  }

  // Check if user is logged in
  if (!window.auth?.currentUser) {
    showError('ai-error', 'Please log in to generate AI images');
    return;
  }

  // Check if user has sufficient credits (20 credits for AI generation)
  if (window.currentCredits < 20) {
    showError(
      'ai-error',
      'You need 20 credits to generate AI images. You have insufficient credits.'
    );
    return;
  }

  // Collect refs + prompt + style, then call generate endpoint
  const base = document.getElementById('ai-prompt');
  const prompt = (base?.value || '').trim();
  const styleSlider = document.getElementById('ai-style-slider');
  const sVal = parseFloat(styleSlider?.value || '0.5');
  const style = sVal < 0.33 ? 'realistic' : sVal > 0.66 ? 'creative' : 'realistic';

  const refs = Array.from(document.querySelectorAll('#remix-assets img, #remix-assets video'))
    .map((el) => el.getAttribute('src') || el.getAttribute('poster'))
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 2);

  // Fallback to simple text-to-image if no refs
  if (refs.length < 2) {
    generateAiImage();
    return;
  }

  // Use existing assets API for AI image generation (single image)
  // We reuse the /assets/ai-images for now with count:1
  (async () => {
    try {
      const { apiFetch } = await import('/api.mjs');
      // Compose a richer prompt mentioning references implicitly
      const styleMap = style === 'creative' ? 'illustration' : 'photographic';
      const data = await apiFetch('/assets/ai-images', {
        method: 'POST',
        body: {
          prompt: `${prompt}`.trim(),
          style: style === 'creative' ? 'creative' : 'realistic',
          count: 1,
        },
      });
      console.log('[AI Image] Response:', data); // Debug log
      if (!data?.ok || !data?.data?.images || data.data.images.length === 0) {
        console.error('[AI Image] Failed:', data);
        showError('ai-error', 'AI image generation failed');
        return;
      }

      const firstImage = data.data.images[0];
      const url = firstImage?.url || null;
      if (!url) {
        showError('ai-error', 'No image URL in response');
        return;
      }

      // Update credits display if successful
      if (data?.data?.creditsDeducted) {
        window.currentCredits -= data.data.creditsDeducted;
        if (window.updateCreditsDisplay) {
          window.updateCreditsDisplay(window.currentCredits);
        }
      }

      // Display result
      const aiBlock = document.getElementById('ai-result-block');
      const aiPrev = document.getElementById('ai-result-preview');
      if (aiBlock && aiPrev) {
        const proxied = `${getApiBase()}/cdn?u=${encodeURIComponent(url)}`;
        aiPrev.innerHTML = `<img crossOrigin="anonymous" src="${proxied}" class="w-full h-full object-cover block" />`;
        aiBlock.classList.remove('hidden');
      }
    } catch (err) {
      if (err?.reason === 'INSUFFICIENT_CREDITS') {
        showError(
          'ai-error',
          'You need 20 credits to generate AI images. You have insufficient credits.'
        );
      } else {
        showError('ai-error', err?.message || 'AI generation error');
      }
    }
  })();
});

// Save & Use handler: persists image URL and marks as selected background
document.addEventListener('click', async (e) => {
  if (e.target?.id !== 'ai-save-use-btn') return;
  e.preventDefault();
  try {
    const imgEl = document.querySelector('#ai-result-preview img');
    const url = imgEl?.getAttribute('src');
    if (!url) return;
    const savedUrl = url;
    try {
      showToast('Save & Use registration is temporarily unavailable in this build.');
    } catch {}
    // Mark selection locally and update preview immediately
    selectedAsset = {
      id: `ai-${Date.now()}`,
      provider: 'ai',
      query: (document.getElementById('ai-prompt')?.value || '').trim(),
      fileUrl: savedUrl,
      thumbUrl: savedUrl,
      width: 1080,
      height: 1920,
    };
    updateRenderPreview();
    updateRenderButtonState();
    // Also update dedicated preview nodes if present
    try {
      // Ensure we have a preview <img id="preview-img"> inside live preview
      let previewImg = document.getElementById('preview-img');
      if (!previewImg) {
        const live = document.getElementById('live-preview-container');
        if (live) {
          live.classList.remove('hidden');
          const holder = live.querySelector('.relative') || live;
          // Force 9x16 preview aspect
          try {
            holder.style.aspectRatio = '9 / 16';
          } catch {}
          try {
            if (!holder.style.background) holder.style.background = '#000';
          } catch {}
          // Clear holder if it only had a canvas (we'll still keep canvas for other flows)
          // but append img above it so swap is visible immediately
          previewImg = document.createElement('img');
          previewImg.id = 'preview-img';
          previewImg.style.width = '100%';
          previewImg.style.height = '100%';
          previewImg.style.display = 'block';
          previewImg.style.objectFit = 'cover';
          holder.prepend(previewImg);
          // Hide canvas during static image preview to avoid black overlay
          try {
            const c = holder.querySelector('#live-preview-canvas');
            if (c) c.style.display = 'none';
          } catch {}
        }
      }
      if (previewImg) {
        try {
          previewImg.crossOrigin = 'anonymous';
        } catch {}
        const proxied = `${getApiBase()}/cdn?u=${encodeURIComponent(savedUrl)}`;
        previewImg.src = proxied;
      }
      // Ensure overlay visible for still image preview
      try {
        const ov = document.getElementById('caption-overlay');
        if (ov) ov.style.display = 'block';
      } catch {}
      const previewBox = document.getElementById('short-preview');
      if (previewBox) {
        const proxied = `${getApiBase()}/cdn?u=${encodeURIComponent(savedUrl)}`;
        previewBox.style.backgroundImage = `url("${proxied}")`;
        previewBox.setAttribute('data-bg', proxied);
      }
      window.VAIFORM = window.VAIFORM || {};
      window.VAIFORM.currentBackgroundUrl = `${getApiBase()}/cdn?u=${encodeURIComponent(savedUrl)}`;
    } catch {}
    // Feedback
    try {
      showToast('✅ Saved to My Images and selected');
    } catch {}
  } catch (err) {
    console.warn('Save & Use failed:', err);
  }
});

// Quote-only event wiring: run only when quote DOM exists (safe for future HTML removal)
document.addEventListener('DOMContentLoaded', () => {
  const hasQuoteUI = !!document.querySelector('[data-mode="quotes"]');
  if (!hasQuoteUI) return;
  // Event listeners - generateQuote now handled by ui-actions.js
  const useTextBtn = document.getElementById('use-text-btn');
  if (useTextBtn) {
    useTextBtn.onclick = () => {
      const input = document.getElementById('quote-text').value.trim();
      if (!input) return;
      currentQuote = { text: input };
      displayQuote(currentQuote);
      // Ensure visible in view mode on use
      const disp = document.getElementById('quote-text-display');
      const ta = document.getElementById('quote-edit');
      ta.classList.add('hidden');
      disp.classList.remove('hidden');
      document.getElementById('save-quote-btn').classList.add('hidden');
      document.getElementById('cancel-quote-btn').classList.add('hidden');
      document.getElementById('edit-quote-btn').classList.remove('hidden');
      // do not reset regen counter here
      try {
        window.VAIFORM = window.VAIFORM || {};
        window.VAIFORM.currentQuoteText = input;
      } catch {}
      try {
        showToast('Quote cloud save is temporarily unavailable in this build.');
      } catch {}

      // Trigger caption preview immediately after using text
      try {
        updateCaptionOverlay(input, true);
      } catch (e) {
        console.warn('[caption-overlay] auto-preview failed (non-fatal)', e);
      }
    };
  }
  // search-assets-btn now handled by ui-actions.js
  const prevPageBtn = document.getElementById('prev-page-btn');
  if (prevPageBtn) prevPageBtn.onclick = () => loadAssets(currentAssetPage - 1);

  const nextPageBtn = document.getElementById('next-page-btn');
  if (nextPageBtn) nextPageBtn.onclick = () => loadAssets(currentAssetPage + 1);

  const generateAiBtn = document.getElementById('generate-ai-btn');
  if (generateAiBtn) generateAiBtn.onclick = generateAiImage;

  const uploadAssetBtn = document.getElementById('upload-asset-btn');
  if (uploadAssetBtn)
    uploadAssetBtn.onclick = () => {
      const uploadInput = document.getElementById('asset-upload-input');
      if (uploadInput) uploadInput.click();
    };
  const assetUploadInput = document.getElementById('asset-upload-input');
  if (assetUploadInput) assetUploadInput.onchange = (e) => handleFileUpload(e.target.files);

  const clearRemixBtn = document.getElementById('clear-remix-btn');
  if (clearRemixBtn)
    clearRemixBtn.onclick = () => {
      remixAssets = [];
      updateRemixArea();
    };

  const renderBtn = document.getElementById('render-btn');
  if (renderBtn) renderBtn.onclick = createShort;

  // Wire mobile Create button to same function
  const mobileCreateBtn = document.getElementById('mobile-create-btn');
  if (mobileCreateBtn) mobileCreateBtn.onclick = createShort;

  // Overlay mode toggle event listener (auto-initialize overlay; no extra buttons)
  const overlayModeToggle = document.getElementById('overlay-mode-toggle');
  if (overlayModeToggle) overlayModeToggle.onchange = toggleOverlayMode;

  // Overlay control event listeners
  const showOutlineToggle = document.getElementById('show-outline-toggle');
  if (showOutlineToggle)
    showOutlineToggle.onchange = async () => {
      if (useOverlayMode && overlaySystemInitialized) {
        try {
          const { getCaptionMeta, applyCaptionMeta } = await import('/js/caption-overlay.js');
          const meta = getCaptionMeta();
          meta.showBox = document.getElementById('show-outline-toggle').checked;
          applyCaptionMeta(meta);
        } catch (e) {
          console.warn('[overlay] outline toggle failed', e);
        }
      }
    };

  const responsiveTextToggle = document.getElementById('responsive-text-toggle');
  if (responsiveTextToggle)
    responsiveTextToggle.onchange = async () => {
      if (useOverlayMode && overlaySystemInitialized) {
        try {
          const { getCaptionMeta, applyCaptionMeta } = await import('/js/caption-overlay.js');
          const meta = getCaptionMeta();
          meta.responsiveText = document.getElementById('responsive-text-toggle').checked;
          applyCaptionMeta(meta);
        } catch (e) {
          console.warn('[overlay] responsive text toggle failed', e);
        }
      }
    };

  // Debug function to check overlay system status
  window.debugOverlaySystem = function () {
    console.log('[debug] Overlay system status:', {
      useOverlayMode,
      overlaySystemInitialized,
      hasGetCaptionMeta: typeof window.getCaptionMeta === 'function',
      hasSetQuote: typeof window.setQuote === 'function',
      stageVisible: document.getElementById('stage').style.display !== 'none',
      legacyOverlayVisible: document.getElementById('caption-overlay').style.display !== 'none',
    });

    if (useOverlayMode && overlaySystemInitialized) {
      try {
        const meta = window.getCaptionMeta();
        console.log('[debug] Current overlay meta:', meta);
      } catch (error) {
        console.error('[debug] Failed to get overlay meta:', error);
      }
    }
  };

  // Caption style event listeners
  const captionFont = document.getElementById('caption-font');
  if (captionFont)
    captionFont.onchange = async () => {
      if (useOverlayMode) {
        try {
          const { getCaptionMeta, applyCaptionMeta } = await import('/js/caption-overlay.js');
          const m = getCaptionMeta();
          m.fontFamily = document.getElementById('caption-font').value;
          applyCaptionMeta(m);
        } catch (e) {
          console.warn('[overlay] font apply failed', e);
        }
      }
      updateRenderPreview();
      updateLivePreview();
      updateCaptionOverlay((currentQuote?.text || '').trim(), true);
      updateOverlayCaption((currentQuote?.text || '').trim(), true);
    };
  const captionWeight = document.getElementById('caption-weight');
  if (captionWeight)
    captionWeight.onchange = async () => {
      const newWeight = document.getElementById('caption-weight').value;
      console.log('[controls] Weight changed to:', newWeight);
      if (useOverlayMode) {
        try {
          const { getCaptionMeta, applyCaptionMeta } = await import('/js/caption-overlay.js');
          const m = getCaptionMeta();
          m.weightCss = newWeight;
          applyCaptionMeta(m);
        } catch (e) {
          console.warn('[overlay] weight apply failed', e);
        }
      }
      updateRenderPreview();
      updateLivePreview();
      updateCaptionOverlay((currentQuote?.text || '').trim(), true);
      updateOverlayCaption((currentQuote?.text || '').trim(), true);
    };
  // Legacy caption-size handler removed - now handled by initCaptionSizeUI()
  document.getElementById('caption-opacity').oninput = async () => {
    const newOpacity = document.getElementById('caption-opacity').value;
    console.log('[controls] Opacity changed to:', newOpacity);
    if (useOverlayMode) {
      try {
        const { getCaptionMeta, applyCaptionMeta } = await import('/js/caption-overlay.js');
        const m = getCaptionMeta();
        m.opacity = parseInt(newOpacity) / 100;
        applyCaptionMeta(m);
      } catch (e) {
        console.warn('[overlay] opacity apply failed', e);
      }
    }
    updateCaptionStyleValues();
    updateCaptionOverlay((currentQuote?.text || '').trim(), true);
    updateOverlayCaption((currentQuote?.text || '').trim(), true);
  };
  const captionPlacement = document.getElementById('caption-placement');
  if (captionPlacement)
    captionPlacement.onchange = () => {
      const newPlacement = document.getElementById('caption-placement').value;
      console.log('[controls] Placement changed to:', newPlacement);

      // Snap box using overlay API
      if (window.OverlayAPI?.snapToPlacement) {
        window.OverlayAPI.snapToPlacement(newPlacement);
      }

      updateRenderPreview();
    };
  const captionBackground = document.getElementById('caption-background');
  if (captionBackground)
    captionBackground.onchange = () => {
      updateRenderPreview();
      updateLivePreview();
      updateCaptionOverlay((currentQuote?.text || '').trim(), true);
      updateOverlayCaption((currentQuote?.text || '').trim(), true);
    };
  document.getElementById('caption-bg-opacity').oninput = () => {
    updateCaptionStyleValues();
    updateCaptionOverlay((currentQuote?.text || '').trim(), true);
  };

  // Voiceover event listeners
  const voiceoverVoice = document.getElementById('voiceover-voice');
  if (voiceoverVoice)
    voiceoverVoice.onchange = () => {
      const voiceSelect = document.getElementById('voiceover-voice');
      currentVoiceId = voiceSelect.value || null;
      updateRenderPreview();
    };
  const previewVoiceBtn = document.getElementById('preview-voice-btn');
  if (previewVoiceBtn) previewVoiceBtn.onclick = previewVoice;

  // TTS Settings event handlers
  document.getElementById('tts-stability').oninput = function () {
    document.getElementById('stability-value').textContent = this.value;
    updateRenderPreview();
  };
  document.getElementById('tts-similarity').oninput = function () {
    document.getElementById('similarity-value').textContent = this.value;
    updateRenderPreview();
  };
  document.getElementById('tts-style').oninput = function () {
    document.getElementById('style-value').textContent = this.value;
    updateRenderPreview();
  };
  const ttsSpeakerBoost = document.getElementById('tts-speaker-boost');
  if (ttsSpeakerBoost)
    ttsSpeakerBoost.onchange = function () {
      updateRenderPreview();
    };

  // Remix button event listeners now handled by ui-actions.js

  // Inline edit handlers - converted to named functions for ui-actions.js
  function editQuote() {
    const disp = document.getElementById('quote-text-display');
    const ta = document.getElementById('quote-edit');
    ta.value = (currentQuote?.text || '').trim();
    disp.classList.add('hidden');
    ta.classList.remove('hidden');
    document.getElementById('save-quote-btn').classList.remove('hidden');
    document.getElementById('cancel-quote-btn').classList.remove('hidden');
    document.getElementById('edit-quote-btn').classList.add('hidden');
    // While editing, hide caption overlay
    updateCaptionOverlay('', false);
  }

  function cancelEdit() {
    const disp = document.getElementById('quote-text-display');
    const ta = document.getElementById('quote-edit');
    // remain in edit mode but clear contents
    ta.value = '';
    updateCaptionOverlay('', false);
    // do not change regen counter
  }

  async function saveQuote() {
    const ta = document.getElementById('quote-edit');
    const newText = ta.value.trim().slice(0, 200);
    if (!newText) return;
    currentQuote = { ...(currentQuote || {}), text: newText };
    document.getElementById('quote-text-display').textContent = newText;
    // do not reset regen counter on save
    // switch to locked/solid view after save

    // Invalidate saved preview since quote text changed
    if (window.markPreviewUnsaved) {
      window.markPreviewUnsaved();
      updateRenderButtonState();
    }
    ta.classList.add('hidden');
    document.getElementById('quote-text-display').classList.remove('hidden');
    document.getElementById('save-quote-btn').classList.add('hidden');
    document.getElementById('cancel-quote-btn').classList.add('hidden');
    document.getElementById('edit-quote-btn').classList.remove('hidden');
    updateRenderPreview();

    // Always show caption after save (even with no media)
    try {
      console.log('[save] caption text:', newText);
      await ensureOverlayActive();

      if (useOverlayMode && overlaySystemInitialized) {
        console.log('[overlay-caption] set:', newText.substring(0, 80));
        await updateOverlayCaption(newText, true);

        // If no media selected yet, ensure stage stays visible with black background
        if (!selectedAsset) {
          const stage = document.getElementById('stage');
          const previewMedia = document.getElementById('previewMedia');

          // Ensure stage has minimum dimensions (prevent collapse)
          if (stage) {
            stage.style.display = 'block';
            stage.style.minHeight = '400px';
            stage.style.backgroundColor = '#000';
          }

          if (previewMedia) {
            // 1x1 black pixel data URL (more deterministic than CSS background)
            previewMedia.src =
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            previewMedia.style.display = 'block';
            console.log(
              '[overlay-save] text: "' + newText.substring(0, 40) + '...", hasMedia: false'
            );
          }
        } else {
          console.log('[overlay-save] text: "' + newText.substring(0, 40) + '...", hasMedia: true');
        }

        // Ensure overlay is visible on top
        try {
          const { ensureOverlayTopAndVisible } = await import('/js/caption-overlay.js');
          ensureOverlayTopAndVisible('#stage');
        } catch {}
      } else {
        updateCaptionOverlay(newText, true);
      }
    } catch (e) {
      console.warn('[overlay] save→overlay failed', e);
    }

    // Persist to backend so it can be used in the short without CORS issues
    try {
      window.VAIFORM = window.VAIFORM || {};
      window.VAIFORM.currentQuoteText = newText;
    } catch {}
    try {
      showToast('Quote cloud save is temporarily unavailable in this build.');
    } catch {}
  }

  // Expose to window scope for ui-actions.js
  window.editQuote = editQuote;
  window.cancelEdit = cancelEdit;
  window.saveQuote = saveQuote;

  // Character counter for input
  document.getElementById('quote-text').addEventListener('input', (e) => {
    const v = e.target.value || '';
    const n = Math.min(200, v.length);
    document.getElementById('quote-char-count').textContent = `${n}/200`;
  });

  // Also update counter when typing inside the inlaid editor
  document.getElementById('quote-edit').addEventListener('input', (e) => {
    const v = e.target.value || '';
    const n = Math.min(200, v.length);
    document.getElementById('quote-char-count').textContent = `${n}/200`;
    // live overlay while editing
    try {
      updateCaptionOverlay(v, true);
    } catch {}
  });

  // Resize listener for zoom/resize scenarios - re-render preview
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      // Skip overlay positioning if drag is active
      if (!window.__overlayIsDragging) {
        try {
          import('/js/caption-overlay.js').then(({ ensureOverlayTopAndVisible }) =>
            ensureOverlayTopAndVisible('#stage')
          );
        } catch {}
      }
      if (selectedAsset) {
        if (_currentPexelsPhoto && selectedAsset?.provider === 'pexels') {
          // Preserve existing previewUrl when updating selectedAsset
          const existingPreviewUrl = selectedAsset.previewUrl;
          selectedAsset = { ...selectedAsset, ..._currentPexelsPhoto };
          if (existingPreviewUrl) {
            selectedAsset.previewUrl = existingPreviewUrl;
          }
          onPexelsUse(_currentPexelsPhoto);
        } else {
          // For non-Pexels assets, just redraw the preview
          updateLivePreview();
        }
      }
    }, 150); // Debounce resize events
  });
});

// Tab switching is now handled by the delegated router in ui-actions.js
// No duplicate onclick handlers needed

// Initialize authentication using existing system
// Note: Theme initialization is handled by header.js and early script in <head>
document.addEventListener('DOMContentLoaded', () => {
  const hasQuoteUI = !!document.querySelector('[data-mode="quotes"]');

  // Wait for auth system to be ready
  const checkAuth = () => {
    if (window.auth && window.onAuthStateChanged) {
      // Listen for auth state changes
      window.onAuthStateChanged(window.auth, async (user) => {
        const loggedIn = !!user;

        // Update UI visibility
        document
          .querySelectorAll('.logged-in')
          ?.forEach((el) => el.classList.toggle('hidden', !loggedIn));
        document
          .querySelectorAll('.logged-out')
          ?.forEach((el) => el.classList.toggle('hidden', loggedIn));

        if (!loggedIn) {
          updateCreditUI(0);
          updateRenderButtonState();
          return;
        }

        try {
          // Give api.mjs a brief moment to obtain the token via the bridge
          if (window.__vaiform_diag__?.tokenWait) {
            await window.__vaiform_diag__.tokenWait(4000);
          }
          await refreshCredits(true);

          // Update render button state after auth changes
          updateRenderButtonState();

          // Load voices with a small delay to ensure auth is fully ready
          setTimeout(() => {
            loadVoices();
          }, 500);
        } catch (e) {
          console.error('Failed to refresh credits:', e);
        }
      });
    } else {
      // Retry in 100ms if auth not ready yet
      setTimeout(checkAuth, 100);
    }
  };

  checkAuth();

  // Initialize quote editor for manual entry from the start (quote UI only)
  if (hasQuoteUI) {
    try {
      const seedInput = document.getElementById('quote-text');
      const seed = (seedInput?.value || '').trim();
      // Use default caption if no seed text provided
      const defaultCaption =
        seed || 'Success is the result of persistent effort and unwavering belief in yourself.';
      currentQuote = { text: defaultCaption };
      displayQuote(currentQuote);
      // Switch to edit mode by default so users can type immediately
      const disp = document.getElementById('quote-text-display');
      const ta = document.getElementById('quote-edit');
      disp.classList.add('hidden');
      ta.classList.remove('hidden');
      document.getElementById('save-quote-btn').classList.remove('hidden');
      document.getElementById('cancel-quote-btn').classList.remove('hidden');
      document.getElementById('edit-quote-btn').classList.add('hidden');
      // Do not reset regen counter on init
      // Fix E: Initialize preview system after content is ready
      try {
        initPreviewSystem();

        // Fix E: Add ResizeObserver for canvas resizing
        const canvas = document.getElementById('live-preview-canvas');
        const container = document.getElementById('live-preview-container');
        if (canvas && container) {
          new ResizeObserver(() => {
            if (window.__overlayIsDragging) return; // Skip during drag
            if (sizeCanvasToCSS(canvas)) {
              // Trigger preview update on resize
              if (currentQuote?.text && selectedAsset) {
                updateLivePreview();
                updateCaptionOverlay(currentQuote.text.trim(), true);
              }
            }
          }).observe(container);
        }
      } catch (e) {
        console.warn('[preview-init] failed:', e);
      }

      // Seed char counter
      const n = Math.min(200, defaultCaption.length);
      const cc = document.getElementById('quote-char-count');
      if (cc) cc.textContent = `${n}/200`;
    } catch {}
  }
});

// Fix E: Ensure the first render actually fires
window.addEventListener('load', () => {
  if (!document.getElementById('live-preview-container')) return;
  console.log('[preview-init] Page loaded, initializing preview');
  initPreviewSystem();

  // Setup canvas observer for new preview fixes
  if (window.__PREVIEW_FIX__) {
    setupCanvasObserver();

    // Re-run render on visibilitychange when tab becomes visible
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && canvasReadyState.ready) {
        console.log('[preview-init] Tab visible, reinitializing preview');
        scheduleRender();
      }
    });
  }

  // Also trigger preview if we already have both quote and asset
  if (currentQuote && selectedAsset) {
    console.log('[preview-init] Both quote and asset available, triggering preview');
    updateLivePreview();
    updateCaptionOverlay(currentQuote.text.trim(), true);
  }
});

// Removed duplicate visibilitychange listener - consolidated into DOMContentLoaded handler above
