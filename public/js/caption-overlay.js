/**
 * Draggable Caption Overlay System
 * Provides draggable, resizable caption overlay with style controls.
 * Exposes: initCaptionOverlay, getCaptionMeta, applyCaptionMeta, setQuote
 */

// @test-plan
// - With overlayV2=1 flag, type and resize: text scales smoothly with the box, no jumps.
// - Drag/resize tiny→full: font follows box; releasing pointer does not change size.
// - Toggle edit mode: no vertical shift (handle hidden via opacity only).
// - overlayV2 off: legacy behavior unchanged.

function detectOverlayV2() {
  try {
    const params = new URLSearchParams(location.search || '');
    const urlOn = params.get('overlayV2') === '1';
    const urlOff = params.get('overlayV2') === '0';
    const lsOn = (localStorage.getItem('overlayV2') || '') === '1';
    const debugOn = params.get('debugOverlay') === '1' || (localStorage.getItem('debugOverlay') || '') === '1';
    if (typeof window !== 'undefined') {
      // SSOT: default V2 ON when overlay mode is active; allow explicit opt-out via overlayV2=0
      const overlayModeIsActive = true; // creative.html always initializes overlay system
      const v2 = urlOff ? false : (urlOn || lsOn || overlayModeIsActive);
      window.__overlayV2 = !!v2;
      window.__debugOverlay = !!debugOn;
    }
    return window.__overlayV2 === true;
  } catch { return false; }
}

export function initCaptionOverlay({ stageSel = '#stage', mediaSel = '#previewMedia' } = {}) {
  const stage = document.querySelector(stageSel);
  if (!stage) throw new Error('stage not found');
  const overlayV2 = detectOverlayV2();
  // Debug counters (printed only when debug flag enabled)
  let __pm = 0, __ro = 0, __raf = 0;

  // V2 sticky-bounds fitter state
  const MIN_PX = 32, MAX_PX = 120;
  const v2State = {
    isResizing: false,
    rafPending: false,
    lastBoxW: 0,
    lastBoxH: 0,
    fitBounds: { lowPx: MIN_PX, highPx: MAX_PX, lastGoodPx: null }
  };
  
  // Ensure stage has aspect ratio consistent with final output
  stage.classList.add('caption-stage');

  // Build overlay DOM
  const box = document.createElement('div');
  box.className = 'caption-box';
  box.style.left = '10%';
  box.style.top  = '65%';
  box.style.width = '80%';
  box.style.minWidth = '140px';
  box.style.minHeight = '80px';

  const handle = document.createElement('div');
  handle.className = 'drag-handle';
  handle.textContent = '✥ drag';
  
  const content = document.createElement('div');
  content.className = 'content';
  content.contentEditable = 'true';
  content.textContent = 'Your quote goes here…';

  // Add custom resize handle
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'drag-resize';
  resizeHandle.innerHTML = '↘';

  box.appendChild(handle);
  box.appendChild(content);
  box.appendChild(resizeHandle);
  stage.appendChild(box);

  // Style (inline so we don't require new CSS file)
  const style = document.createElement('style');
  style.textContent = `
    .caption-stage{ position:relative; border-radius:12px; overflow:hidden }
    .caption-stage img,.caption-stage video{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; pointer-events:none }
    .caption-box{ position:absolute; resize:none; overflow:hidden; outline:1.5px dashed rgba(255,255,255,.45);
      border-radius:12px; z-index:9999; touch-action:none; user-select:none; background:rgba(0,0,0,.25); box-sizing:border-box; }
    .caption-box.is-boxless{ background:transparent; outline:none; }
    .caption-box:hover:not(.is-boxless){ outline-style:solid; }
    .caption-box:not(.editing){ outline:none; background:transparent; }
    /* Legacy: hide chrome by display:none; V2 overrides below to keep layout stable */
    .caption-box:not(.editing) .drag-handle{ display:none; }
    .caption-box:not(.editing) .drag-resize{ display:none; }
    .caption-box .drag-handle{ position:absolute; top:0; left:0; cursor:move; user-select:none; padding:6px 10px; background:rgba(0,0,0,.25);
      border-top-left-radius:12px; border-top-right-radius:12px; font: 12px/1 system-ui; letter-spacing:.08em; text-transform:uppercase; }
    .caption-box .content{ padding:28px 12px 12px 12px; outline:none; white-space:pre-wrap; word-break:normal; overflow-wrap:normal; hyphens:none; overflow:hidden; box-sizing:border-box;
      color:#fff; text-align:center; font-weight:800; font-size:38px; line-height:1.15; text-shadow:0 2px 12px rgba(0,0,0,.65);
      font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
    .caption-box .drag-resize{ position:absolute; right:0; bottom:0; width:16px; height:16px;
      cursor:nwse-resize; border-right:2px solid #fff; border-bottom:2px solid #fff; opacity:.7; }
    /* V2: keep chrome in layout to avoid measurement shifts; hide via opacity/pointer-events */
    .caption-box.always-handle .drag-handle{ display:block; opacity:0; pointer-events:none; }
    .caption-box.always-handle.editing .drag-handle{ opacity:1; pointer-events:auto; }
    .caption-box.always-handle .drag-resize{ display:block; opacity:0; pointer-events:none; }
    .caption-box.always-handle.editing .drag-resize{ opacity:0.7; pointer-events:auto; }
  `;
  document.head.appendChild(style);

  // Snap into view on next frame to avoid off-viewport placement
  try { requestAnimationFrame(() => { try { ensureOverlayTopAndVisible(stageSel); } catch {} }); } catch {}

  // Drag behavior (strict: only move while actively dragging)
  let drag = null; let dragging = false;
  handle.addEventListener('pointerdown', (e)=>{
    const s = stage.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    drag = { startX: e.clientX, startY: e.clientY, ox: b.left - s.left, oy: b.top - s.top, sw: s.width, sh: s.height, bw: b.width, bh: b.height };
    handle.setPointerCapture(e.pointerId);
    dragging = true;
    try {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      console.log('[overlay] pointerdown at', e.clientX, e.clientY, 'elementUnder', el?.tagName, el?.id || el?.className || '');
    } catch {}
  });
  
  const onMove = (e)=>{
    if(!dragging || !drag) return; // stop hover push
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    let x = Math.max(0, Math.min(drag.ox + dx, drag.sw - drag.bw));
    let y = Math.max(0, Math.min(drag.oy + dy, drag.sh - drag.bh));
    box.style.left = (x / drag.sw * 100) + '%';
    box.style.top  = (y / drag.sh * 100) + '%';
    clampToStage(); // Ensure box stays within stage
  };

  // Listen on document so moving fast outside handle doesn't break drag (legacy)
  if (!overlayV2) {
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerup', ()=> { dragging = false; drag = null; }, { passive: true });
    document.addEventListener('pointercancel', ()=> { dragging = false; drag = null; }, { passive: true });
  } else {
    // V2: keep drag local to handle via capture
    handle.addEventListener('pointermove', onMove, { passive: true });
    handle.addEventListener('pointerup', ()=> { dragging = false; drag = null; }, { passive: true });
    handle.addEventListener('pointercancel', ()=> { dragging = false; drag = null; }, { passive: true });
  }

  // Keep inside frame on resize and clamp to stage
  const clamp = ()=>{
    if (overlayV2 && window.__debugOverlay) { try { __ro++; } catch {} }
    if (overlayV2 && v2State.isResizing) return; // observer no-op during V2 resize
    const s = stage.getBoundingClientRect(), b = box.getBoundingClientRect();
    let x = Math.max(0, Math.min(b.left - s.left, s.width - b.width));
    let y = Math.max(0, Math.min(b.top  - s.top,  s.height - b.height));
    box.style.left = (x / s.width * 100) + '%';
    box.style.top  = (y / s.height * 100) + '%';
    box.style.width  = Math.min(b.width,  s.width) + 'px';
    box.style.height = Math.min(b.height, s.height) + 'px';
  };
  
  // Clamp box to stage boundaries
  const clampToStage = () => {
    const s = stage.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const pad = 8;
    
    let x = Math.max(pad, Math.min(b.left - s.left, s.width - b.width - pad));
    let y = Math.max(pad, Math.min(b.top - s.top, s.height - b.height - pad));
    
    box.style.left = (x / s.width * 100) + '%';
    box.style.top = (y / s.height * 100) + '%';
  };
  
  new ResizeObserver(clamp).observe(box);
  window.addEventListener('resize', clamp);
  
  // Add editing state management
  let isEditing = false;
  
  const setEditing = (editing) => {
    isEditing = editing;
    if (editing) {
      box.classList.add('editing');
    } else {
      box.classList.remove('editing');
    }
  };
  
  // Click outside to exit editing mode
  document.addEventListener('click', (e) => {
    if (!box.contains(e.target)) {
      setEditing(false);
    }
  });
  
  // Click on box to enter editing mode
  box.addEventListener('click', (e) => {
    if (!isEditing) {
      setEditing(true);
    }
  });

  // Auto-size functionality
  function setTextAutoSize(text) {
    content.textContent = text;
    if (overlayV2) { try { ensureFitNextRAF('setText'); } catch {}; return; }
    // Legacy path below
    content.style.width = 'auto';
    content.style.maxWidth = 'unset';
    box.style.width = 'auto';
    box.style.height = 'auto';
    const stageW = stage.clientWidth;
    const maxW = Math.round(0.9 * stageW);
    const minW = Math.round(0.3 * stageW);
    let w = Math.min(Math.max(content.scrollWidth + 24, minW), maxW);
    content.style.maxWidth = w + 'px';
    box.style.width = w + 'px';
    let meta = getCaptionMeta();
    let tries = 0;
    while (content.scrollHeight > stage.clientHeight * 0.8 && meta.fontPx > 22 && tries++ < 20) {
      meta.fontPx = meta.fontPx - 2;
      applyCaptionMeta(meta);
    }
    meta.wPct = w / stageW;
    applyCaptionMeta(meta);
    clampToStage();
  }

  // Auto shrink-to-fit when overflowing
  const shrinkToFit = (el, container, minPx=18)=>{
    const s = getComputedStyle(el);
    const padX = parseInt(s.paddingLeft,10)+parseInt(s.paddingRight,10);
    const padY = parseInt(s.paddingTop,10)+parseInt(s.paddingBottom,10);
    el.style.maxWidth = (container.clientWidth - padX)+'px';
    let px = parseInt(s.fontSize,10);
    const maxH = container.clientHeight - padY;
    while ((el.scrollHeight > maxH || el.scrollWidth > container.clientWidth - padX) && px > minPx) {
      px -= 1; el.style.fontSize = px + 'px';
    }
  };
  // Only fit on text input, not during resize; resize uses the rAF fitText flow
  content.addEventListener('input', ()=> {
    clearTimeout(fitTimer);
    if (overlayV2) { try { ensureFitNextRAF('input'); } catch {} }
    else {
      fitTimer = setTimeout(fitText, 0);
    }
  });
  // Remove box resize observer that competes with our custom resize

  // Fit text using binary search for smooth, stable scaling (no word splitting)
  let fitTimer = null;
  const fits = (px) => {
    content.style.fontSize = px + 'px';
    // Force reflow measurement against content box
    const s = getComputedStyle(content);
    const padX = parseInt(s.paddingLeft,10) + parseInt(s.paddingRight,10);
    const padY = parseInt(s.paddingTop,10) + parseInt(s.paddingBottom,10);
    const maxW = Math.max(0, box.clientWidth - padX);
    const maxH = Math.max(0, box.clientHeight - padY);
    // scroll sizes reflect laid out text; compare to content box
    const ok = (content.scrollWidth <= maxW + 0.5) && (content.scrollHeight <= maxH + 0.5);
    return { ok, maxW, maxH };
  };
  const fitText = () => {
    let lo = 12, hi = 200, best = 12;
    const current = parseInt(getComputedStyle(content).fontSize, 10) || 24;
    // tighten search window around current to reduce work
    lo = Math.max(12, Math.floor(current * 0.6));
    hi = Math.min(220, Math.ceil(current * 1.8));
    for (let i = 0; i < 12 && lo <= hi; i++) {
      const mid = Math.floor((lo + hi) / 2);
      const { ok } = fits(mid);
      if (ok) { best = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    content.style.fontSize = best + 'px';
  };

  // V2: single rAF pipeline and sticky-bounds binary search fitter
  function beginResizeSession() {
    v2State.isResizing = true;
    const c = parseInt(getComputedStyle(content).fontSize, 10) || MIN_PX;
    v2State.fitBounds.lowPx = Math.max(MIN_PX, Math.floor(c * 0.6));
    v2State.fitBounds.highPx = Math.min(MAX_PX, Math.ceil(c * 1.8));
    v2State.fitBounds.lastGoodPx = Math.max(MIN_PX, Math.min(MAX_PX, c));
    const b = box.getBoundingClientRect();
    v2State.lastBoxW = b.width; v2State.lastBoxH = b.height;
    try { if (window.__overlayV2 && window.__debugOverlay) console.log(JSON.stringify({ tag:'overlay:session', phase:'start', c, lo:v2State.fitBounds.lowPx, hi:v2State.fitBounds.highPx })); } catch {}
  }

  function endResizeSession() {
    try { fitTextV2('pointerup'); } catch {}
    v2State.isResizing = false;
    v2State.rafPending = false;
    try { if (window.__overlayV2 && window.__debugOverlay) console.log(JSON.stringify({ tag:'overlay:session', phase:'end', best:v2State.fitBounds.lastGoodPx })); } catch {}
  }

  function ensureFitNextRAF(reason) {
    if (!overlayV2) { try { requestAnimationFrame(fitText); } catch {} return; }
    if (v2State.rafPending) return;
    v2State.rafPending = true;
    requestAnimationFrame(() => { __raf++; v2State.rafPending = false; try { fitTextV2(reason); } catch {} });
  }

  function fitTextV2(reason) {
    // Decide direction to adjust bounds
    const s = getComputedStyle(content);
    const padX = parseInt(s.paddingLeft,10) + parseInt(s.paddingRight,10);
    const padY = parseInt(s.paddingTop,10) + parseInt(s.paddingBottom,10);
    const maxW = Math.max(0, box.clientWidth - padX);
    const maxH = Math.max(0, box.clientHeight - padY);
    const b = box.getBoundingClientRect();
    const expanding = (b.width >= v2State.lastBoxW) && (b.height >= v2State.lastBoxH);
    const currentPx = parseInt(s.fontSize, 10) || MIN_PX;
    try { if (window.__overlayV2 && window.__debugOverlay) console.log(JSON.stringify({ tag:'fit:start', reason, lowPx: v2State.fitBounds.lowPx, highPx: v2State.fitBounds.highPx, currentPx })); } catch {}
    if (expanding) {
      const mid = Math.floor((v2State.fitBounds.lowPx + v2State.fitBounds.highPx) / 2);
      v2State.fitBounds.lowPx = Math.min(MAX_PX, Math.max(v2State.fitBounds.lowPx, Math.max(currentPx, mid)));
    } else {
      const mid = Math.floor((v2State.fitBounds.lowPx + v2State.fitBounds.highPx) / 2);
      v2State.fitBounds.highPx = Math.max(MIN_PX, Math.min(v2State.fitBounds.highPx, Math.min(currentPx, mid)));
    }
    let lo = Math.max(MIN_PX, v2State.fitBounds.lowPx);
    let hi = Math.min(MAX_PX, v2State.fitBounds.highPx);
    let best = Math.round(v2State.fitBounds.lastGoodPx || lo);
    for (let i = 0; i < 8 && lo <= hi; i++) {
      const mid = (lo + hi) >> 1;
      content.style.fontSize = mid + 'px';
      const ok = (content.scrollWidth <= maxW + 0.5) && (content.scrollHeight <= maxH + 0.5);
      if (ok) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    const prev = v2State.fitBounds.lastGoodPx != null ? v2State.fitBounds.lastGoodPx : best;
    const step = 3;
    let target = best;
    if (best > prev) target = Math.min(best, prev + step);
    else if (best < prev) target = Math.max(best, prev - step);
    target = Math.max(MIN_PX, Math.min(MAX_PX, target));
    content.style.fontSize = target + 'px';
    v2State.fitBounds.lastGoodPx = target;
    v2State.lastBoxW = b.width; v2State.lastBoxH = b.height;
    try {
      if (window.__overlayV2 && window.__debugOverlay) {
        console.log(JSON.stringify({ tag:'fit:ok', bestPx: target }));
        console.log(JSON.stringify({ tag:'fit:apply', fontPx: target, boxW: box.clientWidth, boxH: box.clientHeight }));
      }
    } catch {}
  }

  // Custom resize handle functionality
  let resizeStart = null;
  resizeHandle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { resizeHandle.setPointerCapture(e.pointerId); } catch {}
    const start = {x: e.clientX, y: e.clientY, w: box.offsetWidth, h: box.offsetHeight, left: box.offsetLeft, top: box.offsetTop};
    const initialFontPx = parseInt(getComputedStyle(content).fontSize, 10);
    if (overlayV2) beginResizeSession();
    
    function move(ev) {
      // delta from pointer movement
      if (overlayV2 && window.__debugOverlay) { try { __pm++; } catch {} }
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      // proposed size
      let w = start.w + dx;
      let h = start.h + dy;
      // clamp size so bottom-right corner stays under pointer and within stage
      const maxW = stage.clientWidth - start.left;
      const maxH = stage.clientHeight - start.top;
      w = Math.max(60, Math.min(w, maxW));
      h = Math.max(40, Math.min(h, maxH));
      box.style.width = w + 'px';
      box.style.height = h + 'px';

      // V2: coalesce to a single binary-search fit via one rAF; no timers during drag
      if (overlayV2) {
        clearTimeout(fitTimer);
        try { if (window.__debugOverlay) console.log(JSON.stringify({ tag:'resize', w, h, rafPending: v2State.rafPending, isResizing: v2State.isResizing })); } catch {}
        try { ensureFitNextRAF('resize'); } catch {}
      } else {
        // Legacy responsive approximation + final fit
        const responsiveText = document.getElementById('responsive-text-toggle')?.checked ?? true;
        if (responsiveText) {
          const scale = Math.max(w / Math.max(1, start.w), 0.05);
          const targetPx = Math.max(12, Math.min(200, Math.round(initialFontPx * scale)));
          content.style.fontSize = targetPx + 'px';
        }
        clearTimeout(fitTimer);
        fitTimer = setTimeout(()=>{ requestAnimationFrame(fitText); }, 16);
      }
    }
    
    function up(ev) {
      try { box.releasePointerCapture(ev.pointerId); } catch {}
      if (!overlayV2) {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      } else {
        resizeHandle.removeEventListener('pointermove', move);
        resizeHandle.removeEventListener('pointerup', up);
      }
      // Final persist + preview
      if (overlayV2) { try { endResizeSession(); } catch {} } else { try { fitText(); } catch {} }
      const meta = getCaptionMeta();
      applyCaptionMeta(meta);
      if (overlayV2 && window.__debugOverlay) { try { console.log(JSON.stringify({ tag:'overlay:counters', pm:__pm, ro:__ro, raf:__raf })); __pm=__ro=__raf=0; } catch {} }
    }
    if (!overlayV2) {
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    } else {
      resizeHandle.addEventListener('pointermove', move);
      resizeHandle.addEventListener('pointerup', up);
    }
  });

  // Public API on window (simple)
  window.getCaptionMeta = function getCaptionMeta(){
    const s = stage.getBoundingClientRect(), b = box.getBoundingClientRect(), cs = getComputedStyle(content);
    const meta = {
      text: content.innerText.trim(),
      xPct: (b.left - s.left) / s.width,
      yPct: (b.top  - s.top ) / s.height,
      wPct: b.width / s.width,
      hPct: b.height / s.height,
      fontPx: parseInt(cs.fontSize,10),
      weightCss: String(cs.fontWeight),
      lineHeight: cs.lineHeight,
      color: cs.color,
      opacity: Number(cs.opacity || 1),
      textAlign: cs.textAlign,
      paddingPx: parseInt(cs.paddingLeft,10),
      fontFamily: cs.fontFamily,
      showBox: !box.classList.contains('is-boxless'),
      responsiveText: document.getElementById('responsive-text-toggle')?.checked ?? true
    };
    
    // Update global SSOT meta
    window.__overlayMeta = meta;
    return meta;
  };
  
  window.applyCaptionMeta = function applyCaptionMeta(meta, options = {}){
    const s = stage.getBoundingClientRect();
    if (typeof meta.text === 'string') content.innerText = meta.text;
    if (typeof meta.xPct === 'number') box.style.left = (meta.xPct * 100) + '%';
    if (typeof meta.yPct === 'number') box.style.top  = (meta.yPct * 100) + '%';
    if (typeof meta.wPct === 'number') box.style.width  = (meta.wPct * s.width) + 'px';
    if (typeof meta.hPct === 'number') box.style.height = (meta.hPct * s.height) + 'px';
    if (meta.fontPx) content.style.fontSize = meta.fontPx + 'px';
    if (meta.weightCss) content.style.fontWeight = meta.weightCss;
    if (meta.textAlign) content.style.textAlign = meta.textAlign;
    if (meta.color) content.style.color = meta.color;
    if (typeof meta.opacity === 'number') content.style.opacity = String(meta.opacity);
    if (meta.paddingPx != null) content.style.padding = meta.paddingPx + 'px';
    if (meta.fontFamily) content.style.fontFamily = meta.fontFamily;
    
    // Handle showBox toggle
    if (typeof meta.showBox === 'boolean') {
      if (meta.showBox) {
        box.classList.remove('is-boxless');
      } else {
        box.classList.add('is-boxless');
      }
    }
    // Legacy shrinkToFit only when V2 is off
    if (!options.silentPreview && !overlayV2) {
      shrinkToFit(content, box);
    } else if (!options.silentPreview && overlayV2) {
      try { ensureFitNextRAF('apply'); } catch {}
    }
    
    // Update global SSOT meta after applying changes
    window.__overlayMeta = getCaptionMeta();
  };
  
  window.setQuote = function setQuote(text){ 
    if (text && text.trim()) {
      setTextAutoSize(text.trim());
    } else {
      content.innerText = text || ''; 
      if (!overlayV2) shrinkToFit(content, box); else try { ensureFitNextRAF('quote'); } catch {}
    }
    try { ensureOverlayTopAndVisible(stageSel); } catch {}
    
    // Update global SSOT meta after setting quote
    window.__overlayMeta = getCaptionMeta();
  };

  // V2: keep chrome allocated to avoid layout shifts
  if (overlayV2) {
    try { box.classList.add('always-handle'); } catch {}
  }

  // V2: ensure fonts are ready before first fit
  if (overlayV2 && document.fonts && document.fonts.ready) {
    try { document.fonts.ready.then(()=>{ try { ensureFitNextRAF('fonts'); } catch {} }); } catch {}
  }

  // Structured one-line JSON log
  try {
    if (window.__overlayV2 && window.__debugOverlay) {
      const log = { tag: 'overlay:init', v2: true, stageSel, w: stage.clientWidth, h: stage.clientHeight };
      console.log(JSON.stringify(log));
    }
  } catch {}
}

export function getCaptionMeta(){ return window.getCaptionMeta(); }
export function applyCaptionMeta(meta){ return window.applyCaptionMeta(meta); }
export function setQuote(text){ return window.setQuote(text); }

// Ensure the caption box is on top, hit-testable, and inside the stage viewport
export function ensureOverlayTopAndVisible(stageSel = '#stage') {
  const stage = document.querySelector(stageSel);
  const box = stage?.querySelector('.caption-box');
  if (!stage || !box) return;

  // Keep on top in the stage stacking context
  try { stage.appendChild(box); } catch {}
  box.style.position = 'absolute';
  box.style.zIndex = '99999';
  box.style.pointerEvents = 'auto';

  // Neutralize blockers inside stage
  try {
    stage.querySelectorAll('canvas,img,video,#previewMedia,.preview-overlay,#previewOverlayCanvas,#previewOverlayImg')
      .forEach(el => { el.style.pointerEvents = 'none'; el.style.zIndex = '1'; });
  } catch {}

  // Clamp box inside stage (pixels; SSOT preserved for server metrics)
  const sW = stage.clientWidth, sH = stage.clientHeight;
  const bW = box.offsetWidth  || 280;
  const bH = box.offsetHeight || 100;
  const pad = 8;

  // Current numeric left/top (accept % or px)
  const currentLeft = parseFloat(box.style.left);
  const currentTop  = parseFloat(box.style.top);
  let left = Number.isFinite(currentLeft) ? currentLeft : (sW - bW) / 2;
  let top  = Number.isFinite(currentTop)  ? currentTop  : (sH - bH) / 3;

  left = Math.min(Math.max(left, pad), Math.max(0, sW - bW - pad));
  top  = Math.min(Math.max(top,  pad), Math.max(0, sH - bH - pad));

  box.style.left = /%$/.test(box.style.left) ? `${(left / Math.max(1, sW)) * 100}%` : `${left}px`;
  box.style.top  = /%$/.test(box.style.top)  ? `${(top  / Math.max(1, sH)) * 100}%`  : `${top}px`;

  // Ensure stage is visible in viewport for hit testing/dragging
  try { stage.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); } catch {}
  try { console.log('[overlay] snapped caption-box in-view', { left, top, sW, sH, bW, bH }); } catch {}
}

// Optional: bind drag on the entire box (ignores edits inside .content)
export function bindCaptionDrag(stageSel = '#stage') {
  const stage = document.querySelector(stageSel);
  const box = stage?.querySelector('.caption-box');
  if (!stage || !box) return;
  let start = null;

  const onDown = (e) => {
    // Avoid stealing focus while editing text inside content
    if (e.target && (e.target.closest?.('.content'))) return;
    e.preventDefault();
    try { box.setPointerCapture(e.pointerId); } catch {}
    const r = box.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    start = {
      x: e.clientX, y: e.clientY,
      left: parseFloat(box.style.left) || (r.left - s.left),
      top:  parseFloat(box.style.top)  || (r.top  - s.top)
    };
  };

  const onMove = (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const sW = stage.clientWidth, sH = stage.clientHeight;
    const bW = box.offsetWidth,  bH = box.offsetHeight;
    const pad = 8;
    let left = Math.min(Math.max(start.left + dx, pad), Math.max(0, sW - bW - pad));
    let top  = Math.min(Math.max(start.top  + dy, pad), Math.max(0, sH - bH - pad));
    box.style.left = `${left}px`;
    box.style.top  = `${top}px`;
  };

  const onUp = () => { start = null; };

  box.addEventListener('pointerdown', onDown, { passive:false });
  box.addEventListener('pointermove', onMove);
  box.addEventListener('pointerup', onUp);
  box.addEventListener('pointercancel', onUp);
}
