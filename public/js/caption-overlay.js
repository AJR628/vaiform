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

// Geometry dirty flag: tracks when box dimensions change (resize/drag)
let geometryDirty = false;

// Saved preview flag: tracks if we have a saved PNG from server
let savedPreview = false;

export function initCaptionOverlay({ stageSel = '#stage', mediaSel = '#previewMedia' } = {}) {
  const stage = document.querySelector(stageSel);
  if (!stage) throw new Error('stage not found');
  const overlayV2 = detectOverlayV2();
  // Debug counters (printed only when debug flag enabled)
  let __pm = 0, __ro = 0, __raf = 0;

  // Simplified state for measurement-first approach
  const MIN_PX = 12, MAX_PX = 200;
  const v2State = {
    rafPending: false,
    lastFontSize: null,
    lastBoxW: 0,
    lastBoxH: 0
  };
  
  // Ensure stage has aspect ratio consistent with final output
  stage.classList.add('caption-stage');

  // Build overlay DOM
  const box = document.createElement('div');
  box.className = 'caption-box';
  box.style.left = '6%';
  box.style.top  = '5%';
  box.style.width = '88%';
  box.style.height = '30%';
  box.style.minWidth = '140px';
  box.style.minHeight = '80px';
  box.style.maxHeight = '95%';

  const handle = document.createElement('div');
  handle.className = 'drag-handle';
  handle.textContent = '✥';
  
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

  // V2-only floating toolbar DOM (now docked)
  let toolbar = null; let toolbarArrow = null; let toolbarMode = 'inside'; // toolbarMode kept for compatibility but not used for positioning
  if (overlayV2) {
    toolbar = document.createElement('div');
    toolbar.className = 'caption-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.dataset.mode = 'inside';
    toolbar.dataset.compact = '0';

    // Quick row buttons
    const mkBtn = (label, aria, cls='')=>{ const b=document.createElement('button'); b.type='button'; b.className=`ct-btn ${cls}`.trim(); b.textContent=label; b.setAttribute('aria-label', aria); b.tabIndex=0; b.addEventListener('pointerdown', (e)=>e.stopPropagation()); return b; };
    const fontBtn   = mkBtn('Font','Font and spacing','ct-font');
    const decBtn    = mkBtn('A−','Decrease size','ct-size');
    const incBtn    = mkBtn('A+','Increase size','ct-size');
    const boldBtn   = mkBtn('B','Bold','ct-bold');
    const italicBtn = mkBtn('I','Italic','ct-italic');
    const colorBtn  = mkBtn('◼','Color & stroke','ct-color');
    const opBtn     = mkBtn('⧗','Opacity','ct-opacity');
    const alignBtn  = mkBtn('↔','Align & wrap','ct-align');
    const moreBtn   = mkBtn('•••','More','ct-more');
    const row = document.createElement('div'); row.className='ct-row';
    [fontBtn,decBtn,incBtn,boldBtn,italicBtn,colorBtn,opBtn,alignBtn,moreBtn].forEach(b=>row.appendChild(b));
    toolbar.appendChild(row);

    // Arrow for outside docking (no longer needed but keep for compatibility)
    toolbarArrow = document.createElement('div'); toolbarArrow.className='ct-arrow'; toolbar.appendChild(toolbarArrow);

    // Attach to docked container (visibility controlled by container's hidden class)
    try { 
      const container = document.getElementById('caption-toolbar-container');
      if (container) {
        container.appendChild(toolbar);
      } else {
        // Fallback to box if container not found (shouldn't happen)
        box.appendChild(toolbar);
        toolbar.style.display='none';
      }
    } catch {}

    // Wire controls later after styles load
    toolbar.__buttons = { fontBtn, decBtn, incBtn, boldBtn, italicBtn, colorBtn, opBtn, alignBtn, moreBtn };
  }

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
    .caption-box .drag-handle{ position:absolute; top:0; left:0; width:28px; height:28px; display:grid; place-items:center;
      cursor:grab; user-select:none; touch-action:none; 
      font-size:18px; line-height:1; color:rgba(255,255,255,.6); }
    .caption-box .content{ 
      width: 100%; 
      height: 100%; 
      padding:28px 12px 12px 12px; 
      outline:none; 
      white-space:pre-wrap; 
      word-break:normal; 
      overflow-wrap:anywhere; 
      hyphens:none; 
      overflow:hidden; 
      box-sizing:border-box;
      color:#fff; text-align:center; font-weight:800; font-size:38px; line-height:1.15; text-shadow:0 2px 12px rgba(0,0,0,.65);
      font-family: "DejaVu Sans", sans-serif; font-synthesis: none; }
    .caption-box .drag-resize{ position:absolute; right:0; bottom:0; width:16px; height:16px;
      cursor:nwse-resize; border-right:2px solid #fff; border-bottom:2px solid #fff; opacity:.7; }
    /* V2: keep chrome in layout to avoid measurement shifts; always show handle for immediate interaction */
    .caption-box.always-handle .drag-handle{ display:none; pointer-events:none; }
    .caption-box.always-handle.editing .drag-handle{ display:grid; opacity:1; pointer-events:auto; color:rgba(255,255,255,.8); }
    .caption-box.always-handle.editing .drag-handle:hover,
    .caption-box.always-handle.editing .drag-handle:active { opacity:1; color:#fff; }
    .caption-box.always-handle .drag-resize{ display:block; opacity:0.4; pointer-events:auto; }
    .caption-box.always-handle.editing .drag-resize{ opacity:0.7; pointer-events:auto; }
    .caption-box.is-dragging .drag-handle { cursor:grabbing; }
  `;
  document.head.appendChild(style);

  // Toolbar CSS (docked position, no absolute positioning)
  if (overlayV2) {
    const style2 = document.createElement('style');
    style2.textContent = `
      .caption-toolbar{ position:relative; display:flex; gap:6px; align-items:center; padding:6px 8px;
        background:rgba(24,24,27,.55); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
        color:#fff; border-radius:10px; box-shadow:0 4px 16px rgba(0,0,0,.35); z-index:10; pointer-events:auto; }
      .caption-toolbar .ct-row{ display:flex; gap:6px; align-items:center; flex-wrap: wrap; }
      .caption-toolbar .ct-btn{ min-width:44px; min-height:44px; height:auto; padding:8px 12px; border-radius:6px; border:1px solid rgba(255,255,255,.15);
        background:rgba(255,255,255,.08); color:#fff; font: 12px/1 system-ui; letter-spacing:.02em; cursor:pointer; }
      .caption-toolbar .ct-btn:hover{ background:rgba(255,255,255,.16); }
      .caption-toolbar[data-mode="inside"] .ct-arrow{ display:none; }
      .caption-toolbar[data-mode="outside"] .ct-arrow{ display:none; }
      .caption-toolbar[data-compact="1"] .ct-font,
      .caption-toolbar[data-compact="1"] .ct-bold,
      .caption-toolbar[data-compact="1"] .ct-italic,
      .caption-toolbar[data-compact="1"] .ct-color,
      .caption-toolbar[data-compact="1"] .ct-opacity,
      .caption-toolbar[data-compact="2"] .ct-font,
      .caption-toolbar[data-compact="2"] .ct-bold,
      .caption-toolbar[data-compact="2"] .ct-italic,
      .caption-toolbar[data-compact="2"] .ct-color,
      .caption-toolbar[data-compact="2"] .ct-opacity,
      .caption-toolbar[data-compact="2"] .ct-align{ display:none; }
      @media (max-width: 640px) {
        .caption-toolbar .ct-row{ gap:4px; }
        .caption-toolbar .ct-btn{ min-width:40px; padding:6px 10px; }
      }
    `;
    document.head.appendChild(style2);
  }

  // Snap into view on next frame to avoid off-viewport placement
  try { requestAnimationFrame(() => { try { ensureOverlayTopAndVisible(stageSel); } catch {} }); } catch {}

  // Ensure content.maxWidth defaults to 100% (prevents narrow pixel constraints)
  if (overlayV2) {
    content.style.maxWidth = '100%';
    content.style.width = '100%';
    // Trigger initial fit on mount (will run after fonts are ready if needed)
    try { ensureFitNextRAF('initial'); } catch {}
  }

  // Drag behavior (strict: only handle initiates drag)
  let drag = null;
  let dragging = false;

  handle.addEventListener('pointerdown', (e) => {
    // Only left button
    if (e.button !== 0) return;
    
    // Ignore if clicking on toolbar or resize handle
    if (e.target.closest('.caption-toolbar, .drag-resize')) return;
    
    const s = stage.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    
    drag = {
      startX: e.clientX,
      startY: e.clientY,
      ox: b.left - s.left,
      oy: b.top - s.top,
      sw: s.width,
      sh: s.height,
      bw: b.width,
      bh: b.height,
      pointerId: e.pointerId
    };
    
    // Mark geometry dirty and invalidate saved preview
    geometryDirty = true;
    savedPreview = false;
    
    handle.setPointerCapture(e.pointerId);
    dragging = true;
    box.classList.add('is-dragging');
    
    e.preventDefault();
  });

  window.addEventListener('pointermove', (e) => {
    if (!dragging || !drag) return;
    
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    
    // Clamp within stage
    let x = Math.max(0, Math.min(drag.ox + dx, drag.sw - drag.bw));
    let y = Math.max(0, Math.min(drag.oy + dy, drag.sh - drag.bh));
    
    // Update as % for responsive scaling
    box.style.left = (x / drag.sw * 100) + '%';
    box.style.top = (y / drag.sh * 100) + '%';
  });

  const endDrag = () => {
    if (!dragging) return;
    try {
      handle.releasePointerCapture(drag.pointerId);
    } catch {}
    dragging = false;
    drag = null;
    box.classList.remove('is-dragging');
    
    // Emit state to persist new position
    emitCaptionState('dragend');
  };

  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  // Keep inside frame on resize and clamp to stage
  const clamp = ()=>{
    if (overlayV2) return; // V2 mode uses percentage-based positioning via applyCaptionMeta
    if (overlayV2 && window.__debugOverlay) { try { __ro++; } catch {} }
    // Observer can always run - fitText handles debouncing via rafPending
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

  // Toolbar placement (V2 only) - now static/docked, only update compact mode
  function placeToolbar(){
    if (!overlayV2 || !toolbar) return;
    // Toolbar is now docked, so we only need to update compact mode based on container width
    const container = document.getElementById('caption-toolbar-container');
    if (container) {
      const containerWidth = container.getBoundingClientRect().width;
      const compact = containerWidth < 120 ? 2 : (containerWidth < 180 ? 1 : 0);
      toolbar.dataset.compact = String(compact);
    }
  }
  
  // Add editing state management
  let isEditing = false;
  
  const setEditing = (editing) => {
    isEditing = editing;
    if (editing) {
      box.classList.add('editing');
    } else {
      box.classList.remove('editing');
    }
    if (overlayV2 && toolbar) {
      // Toggle container visibility instead of toolbar display
      const container = document.getElementById('caption-toolbar-container');
      if (container) {
        if (editing) {
          container.classList.remove('hidden');
        } else {
          container.classList.add('hidden');
        }
      } else {
        // Fallback to old behavior if container not found
        try { toolbar.style.display = editing ? 'flex' : 'none'; } catch {}
      }
      // Update compact mode on visibility change
      try { requestAnimationFrame(()=>{ placeToolbar(); }); } catch {}
    }
  }
  
  // Click outside to exit editing mode (clean preview)
  document.addEventListener('click', (e) => {
    // Don't exit editing if clicking on toolbar or its container
    const container = document.getElementById('caption-toolbar-container');
    if (container && container.contains(e.target)) {
      return;
    }
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

  // Re-place toolbar while dragging/resizing V2
  if (overlayV2 && toolbar) {
    const placeOnMove = ()=>{ try { requestAnimationFrame(()=>{ placeToolbar(); }); } catch {} };
    handle.addEventListener('pointermove', placeOnMove, { passive:true });
    try { new ResizeObserver(placeOnMove).observe(box); } catch {}
    window.addEventListener('resize', placeOnMove);
    try { stage.addEventListener('scroll', placeOnMove, { passive:true }); } catch {}
  }

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
    // Mark geometry dirty and invalidate saved preview
    geometryDirty = true;
    savedPreview = false;
    
    clearTimeout(fitTimer);
    if (overlayV2) { try { ensureFitNextRAF('input'); } catch {} }
    else {
      fitTimer = setTimeout(fitTextLegacy, 0);
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
    // Ensure wrapping respects the available inner width
    content.style.maxWidth = maxW + 'px';
    // scroll sizes reflect laid out text; compare to content box
    const ok = (content.scrollWidth <= maxW + 0.5) && (content.scrollHeight <= maxH + 0.5);
    return { ok, maxW, maxH };
  };
  // Legacy fitText function - kept for non-V2 mode only
  const fitTextLegacy = () => {
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

  // ========== Core Measurement Functions (Step 2) ==========
  
  /**
   * Get available space in the box after accounting for padding
   */
  function getAvailableBoxSpace() {
    const s = getComputedStyle(content);
    const padX = parseInt(s.paddingLeft, 10) + parseInt(s.paddingRight, 10);
    const padY = parseInt(s.paddingTop, 10) + parseInt(s.paddingBottom, 10);
    // scrollWidth/scrollHeight already include padding, so use the box's
    // client dimensions directly as the available space to avoid
    // double-subtracting padding and forcing the font size to MIN_PX.
    const maxW = Math.max(0, box.clientWidth);
    const maxH = Math.max(0, box.clientHeight);
    return { maxW, maxH, padX, padY };
  }

  /**
   * Measure if text fits at given font size
   */
  function measureTextFit(fontSize, maxW, maxH) {
    content.style.fontSize = fontSize + 'px';
    content.style.maxWidth = maxW + 'px';
    // Force reflow to ensure text wraps
    void content.offsetHeight;
    const scrollW = content.scrollWidth;
    const scrollH = content.scrollHeight;
    const fits = (scrollW <= maxW + 0.5) && (scrollH <= maxH + 0.5);
    return { fits, scrollW, scrollH };
  }

  /**
   * Calculate scale ratio between old and new box dimensions
   */
  function calculateScaleRatio(oldBox, newBox) {
    // Use smaller ratio for conservative scaling (ensures it fits)
    const scaleW = newBox.width / Math.max(1, oldBox.width);
    const scaleH = newBox.height / Math.max(1, oldBox.height);
    return Math.min(scaleW, scaleH);
  }

  /**
   * Find largest font size that fits in the given constraints
   */
  function findLargestFittingSize(startFontSize, maxW, maxH) {
    // If starting from MIN_PX and box dimensions suggest larger fonts are possible,
    // use heuristic starting point to avoid searching from tiny 12px
    let adjustedStartFontSize = startFontSize;
    if (startFontSize <= MIN_PX && maxH > 150 && maxW > 250) {
      // Box is large enough to support much larger fonts
      // Calculate heuristic: use ~15% of height or ~12% of width, whichever is smaller, but at least 24px
      const heuristicH = Math.round(maxH * 0.15);
      const heuristicW = Math.round(maxW * 0.12);
      adjustedStartFontSize = Math.max(24, Math.min(MAX_PX, heuristicH, heuristicW));
      console.log('[findLargestFittingSize] Using heuristic start for large box:', {
        originalStart: startFontSize,
        maxH: Math.round(maxH),
        maxW: Math.round(maxW),
        heuristicStart: adjustedStartFontSize
      });
    }
    
    let lo = MIN_PX;
    let hi = MAX_PX;
    let best = adjustedStartFontSize;

    // Determine search direction based on whether start size fits
    const startMeasurement = measureTextFit(adjustedStartFontSize, maxW, maxH);
    if (startMeasurement.fits) {
      // If it fits, search upward to find largest
      lo = Math.floor(adjustedStartFontSize);
      hi = MAX_PX;
    } else {
      // If it doesn't fit, search downward to find largest that fits
      lo = MIN_PX;
      hi = Math.floor(adjustedStartFontSize);
    }

    // Binary search for largest fitting size
    for (let i = 0; i < 10 && lo <= hi; i++) {
      const mid = Math.floor((lo + hi) / 2);
      const measurement = measureTextFit(mid, maxW, maxH);
      
      if (measurement.fits) {
        best = mid;
        lo = mid + 1; // Try larger
      } else {
        hi = mid - 1; // Try smaller
      }
    }

    // Validate best actually fits
    const finalMeasurement = measureTextFit(best, maxW, maxH);
    if (!finalMeasurement.fits && best > MIN_PX) {
      // Linear search downward from best to find largest that fits
      for (let candidate = best - 1; candidate >= MIN_PX; candidate--) {
        const measurement = measureTextFit(candidate, maxW, maxH);
        if (measurement.fits) {
          return candidate;
        }
      }
      // Fallback to minimum if nothing fits
      return MIN_PX;
    }

    return best;
  }

  // ========== Simple Fitting Function (Step 3) ==========
  
  /**
   * Main text fitting function - measurement-first approach
   */
  function fitText(reason) {
    const { maxW, maxH } = getAvailableBoxSpace();
    const b = box.getBoundingClientRect();
    const currentPx = parseInt(getComputedStyle(content).fontSize, 10) || MIN_PX;
    
    let targetFontSize;
    
    if (reason === 'initial' || reason === 'setText') {
      // Set to 48px default, then fit to maximize
      targetFontSize = 48;
      content.style.fontSize = targetFontSize + 'px';
      // Always search for optimal size on initial load
      targetFontSize = findLargestFittingSize(targetFontSize, maxW, maxH);
      content.style.fontSize = targetFontSize + 'px';
      // Update state and return early
      v2State.lastFontSize = targetFontSize;
      v2State.lastBoxW = b.width;
      v2State.lastBoxH = b.height;
      console.log('[fitText]', {
        reason,
        targetFontSize: Math.round(targetFontSize),
        boxW: Math.round(b.width),
        boxH: Math.round(b.height),
        maxW: Math.round(maxW),
        maxH: Math.round(maxH)
      });
      return;
    } else if (reason === 'resize') {
      // Proportional scaling: calculate scale ratio and apply
      const oldBox = { width: v2State.lastBoxW || b.width, height: v2State.lastBoxH || b.height };
      const newBox = { width: b.width, height: b.height };
      const scaleRatio = calculateScaleRatio(oldBox, newBox);
      targetFontSize = currentPx * scaleRatio;
      targetFontSize = Math.max(MIN_PX, Math.min(MAX_PX, targetFontSize));
      content.style.fontSize = targetFontSize + 'px';
    } else if (reason === 'textChange' || reason === 'toolbar') {
      // Measure current after change, then fit if needed
      targetFontSize = currentPx;
    } else if (reason === 'apply') {
      // Apply reason: detect if currentPx is suspiciously small relative to box size
      // If box is large (e.g., >150px height, >250px width) and font is stuck at MIN_PX, maximize
      const boxIsLarge = b.height > 150 && b.width > 250;
      const fontIsMinimal = currentPx <= MIN_PX;
      
      if (boxIsLarge && fontIsMinimal) {
        // Box can clearly support much larger fonts - don't preserve tiny 12px value
        // Use heuristic starting point based on box dimensions
        targetFontSize = Math.max(24, Math.min(MAX_PX, Math.round(b.height * 0.15), Math.round(b.width * 0.12)));
        console.log('[fitText] Large box detected, maximizing from heuristic:', {
          currentPx,
          boxH: Math.round(b.height),
          boxW: Math.round(b.width),
          heuristicStart: targetFontSize
        });
      } else {
        // Preserve current font size for apply (respecting meta or user choice)
        targetFontSize = currentPx;
      }
    } else {
      // Default: use current size and maximize
      targetFontSize = currentPx;
    }
    
    // Measure if current size fits
    const measurement = measureTextFit(targetFontSize, maxW, maxH);
    
    // If it doesn't fit, search for optimal size
    // For toolbar: only refit if it doesn't fit (respect user's size choice)
    // For apply: maximize if we detected large box with minimal font, otherwise preserve
    // For other reasons, always find largest fitting size
    if (!measurement.fits) {
      targetFontSize = findLargestFittingSize(targetFontSize, maxW, maxH);
      content.style.fontSize = targetFontSize + 'px';
    } else if (reason === 'apply') {
      // For apply: maximize if we started from heuristic (box was large), otherwise preserve
      const boxIsLarge = b.height > 150 && b.width > 250;
      const fontWasMinimal = currentPx <= MIN_PX;
      if (boxIsLarge && fontWasMinimal) {
        // Maximize to fill available space
        targetFontSize = findLargestFittingSize(targetFontSize, maxW, maxH);
        content.style.fontSize = targetFontSize + 'px';
      }
      // Otherwise preserve current size (user's/saved choice)
    } else if (reason !== 'toolbar') {
      // For non-toolbar reasons (including resize, textChange, etc), maximize size even if current fits
      targetFontSize = findLargestFittingSize(targetFontSize, maxW, maxH);
      content.style.fontSize = targetFontSize + 'px';
    }
    
    // Update state
    v2State.lastFontSize = targetFontSize;
    v2State.lastBoxW = b.width;
    v2State.lastBoxH = b.height;
    
    // Debug logging
    const finalMeasurement = measureTextFit(targetFontSize, maxW, maxH);
    console.log('[fitText]', {
      reason,
      targetFontSize: Math.round(targetFontSize),
      boxW: Math.round(b.width),
      boxH: Math.round(b.height),
      maxW: Math.round(maxW),
      maxH: Math.round(maxH),
      scrollW: Math.round(finalMeasurement.scrollW),
      scrollH: Math.round(finalMeasurement.scrollH),
      fits: finalMeasurement.fits
    });
  }

  function ensureFitNextRAF(reason) {
    if (!overlayV2) { try { requestAnimationFrame(fitTextLegacy); } catch {} return; }
    if (v2State.rafPending) return;
    v2State.rafPending = true;
    requestAnimationFrame(() => { 
      __raf++; 
      v2State.rafPending = false; 
      try { 
        fitText(reason);
        // Emit state after fit completes for resize operations to update live preview
        if (reason === 'resize') {
          emitCaptionState('resize');
        }
      } catch {} 
    });
  }


  // Custom resize handle functionality
  let resizeStart = null;
  resizeHandle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { resizeHandle.setPointerCapture(e.pointerId); } catch {}
    
    // Mark geometry dirty and invalidate saved preview
    geometryDirty = true;
    savedPreview = false;
    
    const start = {x: e.clientX, y: e.clientY, w: box.offsetWidth, h: box.offsetHeight, left: box.offsetLeft, top: box.offsetTop};
    const initialFontPx = parseInt(getComputedStyle(content).fontSize, 10);
    // Store initial box dimensions for proportional scaling
    const initialBox = { width: box.offsetWidth, height: box.offsetHeight };
    
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

      // V2: Proportional scaling with real-time fitting
      if (overlayV2) {
        clearTimeout(fitTimer);
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
        fitTimer = setTimeout(()=>{ requestAnimationFrame(fitTextLegacy); }, 16);
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
      // Final fit and emit state
      if (overlayV2) {
        // Ensure one final fit for perfect sizing
        requestAnimationFrame(() => {
          try { 
            fitText('resize');
            // Emit state after final fit completes to ensure live preview gets updated fontSize
            emitCaptionState('resize-end');
          } catch {}
        });
      } else {
        try { fitTextLegacy(); } catch {}
        emitCaptionState('resize-end');
      }
      
      // Keep geometry dirty and invalidate saved preview
      geometryDirty = true;
      savedPreview = false;
      
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
    
    // Extract wrapped text with actual line breaks from DOM
    const extractWrappedText = () => {
      // Use textContent to avoid innerText space-eating bug with wrapped text
      const text = (content.textContent || content.innerText).trim();
      if (!text) return '';
      
      // Create a temporary range to measure actual line breaks
      const range = document.createRange();
      const walker = document.createTreeWalker(
        content,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      
      let wrappedLines = [];
      let currentLine = '';
      let node;
      
      while (node = walker.nextNode()) {
        const nodeText = node.textContent || '';
        
        // Split by actual line breaks in the DOM
        if (nodeText.includes('\n')) {
          const lines = nodeText.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (i === 0) {
              currentLine += lines[i];
            } else {
              if (currentLine.trim()) wrappedLines.push(currentLine.trim());
              currentLine = lines[i];
            }
          }
        } else {
          currentLine += nodeText;
        }
      }
      
      if (currentLine.trim()) wrappedLines.push(currentLine.trim());
      
      // If we couldn't detect line breaks from DOM, measure by width
      if (wrappedLines.length <= 1 && text.length > 0) {
        const words = text.split(/\s+/);
        const maxWidth = content.clientWidth - parseInt(cs.paddingLeft, 10) - parseInt(cs.paddingRight, 10);
        const testCanvas = document.createElement('canvas');
        const ctx = testCanvas.getContext('2d');
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        
        wrappedLines = [];
        let line = '';
        
        for (const word of words) {
          const testLine = line ? line + ' ' + word : word;
          if (ctx.measureText(testLine).width > maxWidth && line) {
            wrappedLines.push(line);
            line = word;
          } else {
            line = testLine;
          }
        }
        if (line) wrappedLines.push(line);
      }
      
      return wrappedLines.join('\n');
    };
    
    // Extract additional styling fields for server PNG generation
    const parseShadow = (shadowStr) => {
      if (!shadowStr || shadowStr === 'none') return { shadowColor: 'rgba(0,0,0,0.6)', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0 };
      const match = shadowStr.match(/(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px\s+(.+)/);
      if (match) {
        return {
          shadowOffsetX: parseFloat(match[1]) || 0,
          shadowOffsetY: parseFloat(match[2]) || 0,
          shadowBlur: parseFloat(match[3]) || 0,
          shadowColor: match[4] || 'rgba(0,0,0,0.6)'
        };
      }
      return { shadowColor: 'rgba(0,0,0,0.6)', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0 };
    };

    const parseStroke = (strokeStr) => {
      if (!strokeStr || strokeStr === 'none') return { strokePx: 0, strokeColor: 'rgba(0,0,0,0.85)' };
      const match = strokeStr.match(/(\d+(?:\.\d+)?)px\s+(.+)/);
      if (match) {
        return {
          strokePx: parseFloat(match[1]) || 0,
          strokeColor: match[2] || 'rgba(0,0,0,0.85)'
        };
      }
      return { strokePx: 0, strokeColor: 'rgba(0,0,0,0.85)' };
    };

    const shadowProps = parseShadow(cs.textShadow);
    const strokeProps = parseStroke(cs.webkitTextStroke || cs.textStroke);

    const meta = {
      text: extractWrappedText(),
      textRaw: (content.textContent || content.innerText).trim(),  // Use textContent to avoid space corruption
      xPct: (b.left - s.left) / s.width,
      yPct: (b.top  - s.top ) / s.height,
      wPct: b.width / s.width,
      hPct: b.height / s.height,
      fontPx: window.__serverCaptionMeta?.fontPx || parseInt(cs.fontSize,10),
      lineSpacingPx: window.__serverCaptionMeta?.lineSpacingPx || (parseInt(cs.lineHeight,10) - parseInt(cs.fontSize,10)),
      weightCss: String(cs.fontWeight),
      fontStyle: cs.fontStyle || 'normal',
      lineHeight: cs.lineHeight,
      letterSpacingPx: parseFloat(cs.letterSpacing) || 0,
      textTransform: cs.textTransform || 'none',
      color: cs.color,
      opacity: Number(cs.opacity || 1),
      textAlign: cs.textAlign,
      paddingPx: parseInt(cs.paddingLeft,10),
      fontFamily: cs.fontFamily,
      showBox: !box.classList.contains('is-boxless'),
      responsiveText: document.getElementById('responsive-text-toggle')?.checked ?? true,
      // Shadow properties
      ...shadowProps,
      // Stroke properties  
      ...strokeProps
    };
    
    // Update global SSOT meta
    window.__overlayMeta = meta;
    return meta;
  };
  
  window.applyCaptionMeta = function applyCaptionMeta(meta, options = {}){
    const s = stage.getBoundingClientRect();
    if (typeof meta.text === 'string') content.textContent = meta.text;
    if (typeof meta.xPct === 'number') box.style.left = (meta.xPct * 100) + '%';
    if (typeof meta.yPct === 'number') box.style.top  = (meta.yPct * 100) + '%';
    if (typeof meta.wPct === 'number') box.style.width  = (meta.wPct * 100) + '%';
    if (typeof meta.hPct === 'number') box.style.height = (meta.hPct * 100) + '%';
    
    // Validate and apply fontPx - check if it's unreasonable for box size
    if (meta.fontPx) {
      const boxRect = box.getBoundingClientRect();
      const boxIsLarge = boxRect.height > 150 && boxRect.width > 250;
      const fontIsUnreasonablySmall = meta.fontPx <= MIN_PX && boxIsLarge;
      
      if (fontIsUnreasonablySmall && !options.silentPreview) {
        console.warn('[applyCaptionMeta] Rejecting unreasonably small fontPx for large box:', {
          fontPx: meta.fontPx,
          boxH: Math.round(boxRect.height),
          boxW: Math.round(boxRect.width),
          suggestion: 'Font will be maximized by fitText instead'
        });
        // Don't apply the tiny fontPx - let fitText maximize it
      } else {
        content.style.fontSize = meta.fontPx + 'px';
      }
    }
    if (meta.weightCss) content.style.fontWeight = meta.weightCss;
    if (meta.textAlign) content.style.textAlign = meta.textAlign;
    if (meta.color) content.style.color = meta.color;
    if (typeof meta.opacity === 'number') content.style.opacity = String(meta.opacity);
    if (meta.paddingPx != null) content.style.padding = meta.paddingPx + 'px';
    if (meta.fontFamily) content.style.fontFamily = meta.fontFamily;
    
    // Prevent browser from synthesizing faux bold/italic
    content.style.fontSynthesis = 'none';
    
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
      content.textContent = text || ''; 
      if (!overlayV2) shrinkToFit(content, box); else try { ensureFitNextRAF('quote'); } catch {}
    }
    try { ensureOverlayTopAndVisible(stageSel); } catch {}
    
    // Update global SSOT meta after setting quote
    window.__overlayMeta = getCaptionMeta();
  };

  // V2: keep chrome allocated to avoid layout shifts
  if (overlayV2) {
    try { box.classList.add('always-handle'); } catch {}
    // Keyboard shortcuts when focusing the text content
    try {
      content.addEventListener('keydown', (e) => {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC')>=0;
        const mod = isMac ? e.metaKey : e.ctrlKey;
        if (mod && (e.key === 'b' || e.key === 'B')) {
          e.preventDefault();
          const w = getComputedStyle(content).fontWeight;
          content.style.fontWeight = (w === '700' || parseInt(w,10) >= 600) ? '400' : '700';
          try { ensureFitNextRAF('kb-bold'); } catch {}
        } else if (mod && (e.key === 'i' || e.key === 'I')) {
          e.preventDefault();
          const fs = getComputedStyle(content).fontStyle;
          content.style.fontStyle = (fs === 'italic') ? 'normal' : 'italic';
          try { ensureFitNextRAF('kb-italic'); } catch {}
        } else if (e.altKey && e.key === 'ArrowLeft') {
          e.preventDefault();
          const px = Math.max(12, (parseInt(getComputedStyle(content).fontSize,10) || 24) - 2);
          content.style.fontSize = px + 'px';
          try { ensureFitNextRAF('kb-size-'); } catch {}
        } else if (e.altKey && e.key === 'ArrowRight') {
          e.preventDefault();
          const px = Math.min(200, (parseInt(getComputedStyle(content).fontSize,10) || 24) + 2);
          content.style.fontSize = px + 'px';
          try { ensureFitNextRAF('kb-size+'); } catch {}
        } else if (e.altKey && (e.key === '1' || e.key === '2' || e.key === '3')) {
          e.preventDefault();
          const val = e.key === '1' ? 'left' : (e.key === '2' ? 'center' : 'right');
          content.style.textAlign = val;
          try { ensureFitNextRAF('kb-align'); } catch {}
        }
      });
    } catch {}
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

  // Wire toolbar control behaviors (V2)
  if (overlayV2 && toolbar && toolbar.__buttons) {
    const { fontBtn, decBtn, incBtn, boldBtn, italicBtn, colorBtn, opBtn, alignBtn, moreBtn } = toolbar.__buttons;
    const scheduleLayout = ()=>{ try { ensureFitNextRAF('toolbar'); } catch {} };
    const openPopover = (anchor, build)=>{
      document.querySelectorAll('.ct-popover').forEach(p=>p.remove());
      const pop = document.createElement('div');
      pop.className = 'ct-popover';
      pop.style.position = 'absolute'; pop.style.zIndex = '100001';
      pop.style.background = 'rgba(24,24,27,.95)'; pop.style.color = '#fff';
      pop.style.padding = '8px'; pop.style.borderRadius = '8px';
      pop.style.boxShadow = '0 8px 24px rgba(0,0,0,.45)';
      build(pop);
      const s = stage.getBoundingClientRect();
      const r = anchor.getBoundingClientRect();
      let left = r.left - s.left, top = r.bottom - s.top + 6;
      pop.style.left = `${Math.round(left)}px`; pop.style.top = `${Math.round(top)}px`;
      const onDoc = (e)=>{ if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); document.removeEventListener('click', onDoc, true); } };
      document.addEventListener('click', onDoc, true);
      stage.appendChild(pop);
    };

    // Font family + line-height + letter-spacing
    fontBtn.onclick = (e)=>{
      openPopover(e.currentTarget, (pop)=>{
        const fam = document.createElement('select'); fam.style.display='block'; fam.style.marginBottom='6px'; fam.style.color='#111';
        ['DejaVu Sans'].forEach(f=>{ const o=document.createElement('option'); o.value=f; o.textContent=f; fam.appendChild(o); });
        fam.value = (getComputedStyle(content).fontFamily||'').split(',')[0].replaceAll('"','').trim();
        fam.onchange = ()=>{ content.style.fontFamily = fam.value + ', system-ui, -apple-system, Segoe UI, Roboto, sans-serif'; scheduleLayout(); emitCaptionState('font-family'); };
        const lhL = document.createElement('div'); lhL.textContent='Line height'; lhL.style.margin='6px 0 2px';
        const lh = document.createElement('input'); lh.type='range'; lh.min='0.9'; lh.max='2.0'; lh.step='0.05'; lh.value=String(parseFloat(getComputedStyle(content).lineHeight)||1.15);
        lh.oninput = ()=>{ content.style.lineHeight = String(lh.value); };
        lh.onchange = ()=>{ scheduleLayout(); emitCaptionState('line-height'); };
        const lsL = document.createElement('div'); lsL.textContent='Letter spacing'; lsL.style.margin='6px 0 2px';
        const ls = document.createElement('input'); ls.type='range'; ls.min='-1'; ls.max='6'; ls.step='0.5'; ls.value=String(parseFloat(getComputedStyle(content).letterSpacing)||0);
        ls.oninput = ()=>{ content.style.letterSpacing = `${ls.value}px`; };
        ls.onchange = ()=>{ scheduleLayout(); emitCaptionState('letter-spacing'); };
        pop.appendChild(fam); pop.appendChild(lhL); pop.appendChild(lh); pop.appendChild(lsL); pop.appendChild(ls);
      });
    };

    // Size
    decBtn.onclick = ()=>{ const v = Math.max(12,(parseInt(getComputedStyle(content).fontSize,10)||24)-2); content.style.fontSize=v+'px'; scheduleLayout(); emitCaptionState('font-size'); };
    incBtn.onclick = ()=>{ const v = Math.min(200,(parseInt(getComputedStyle(content).fontSize,10)||24)+2); content.style.fontSize=v+'px'; scheduleLayout(); emitCaptionState('font-size'); };

    // Bold/Italic
    boldBtn.onclick = ()=>{ const w=getComputedStyle(content).fontWeight; content.style.fontWeight=(w==='700'||parseInt(w,10)>=600)?'400':'700'; content.style.fontSynthesis='none'; scheduleLayout(); emitCaptionState('bold'); };
    italicBtn.onclick = ()=>{ const fs=getComputedStyle(content).fontStyle; content.style.fontStyle=(fs==='italic')?'normal':'italic'; content.style.fontSynthesis='none'; scheduleLayout(); emitCaptionState('italic'); };

    // Color / stroke / shadow (paint-only)
    colorBtn.onclick = (e)=>{
      openPopover(e.currentTarget, (pop)=>{
        const color = document.createElement('input'); color.type='color'; color.value='#ffffff'; color.style.width='100%'; color.oninput=()=>{ content.style.color=color.value; emitCaptionState('color'); };
        const stroke = document.createElement('input'); stroke.type='range'; stroke.min='0'; stroke.max='6'; stroke.step='1'; stroke.value='0'; stroke.style.width='100%';
        stroke.oninput = ()=>{ const sw=parseInt(stroke.value,10)||0; content.style.webkitTextStroke = sw?`${sw}px #000`:''; emitCaptionState('stroke'); };
        const sh = document.createElement('input'); sh.type='range'; sh.min='0'; sh.max='24'; sh.step='1'; sh.value='12'; sh.style.width='100%';
        sh.oninput = ()=>{ const n=parseInt(sh.value,10)||0; content.style.textShadow = n?`0 2px ${Math.round(n)}px rgba(0,0,0,.65)`:'none'; emitCaptionState('shadow'); };
        pop.appendChild(color); pop.appendChild(stroke); pop.appendChild(sh);
      });
    };

    // Opacity (paint-only)
    opBtn.onclick = (e)=>{ openPopover(e.currentTarget, (pop)=>{ const op=document.createElement('input'); op.type='range'; op.min='0'; op.max='1'; op.step='0.05'; op.value=String(parseFloat(getComputedStyle(content).opacity)||1); op.oninput=()=>{ content.style.opacity=String(op.value); emitCaptionState('opacity'); }; pop.appendChild(op); }); };

    // Align
    alignBtn.onclick = (e)=>{ openPopover(e.currentTarget, (pop)=>{ const mk=(t,v)=>{ const b=document.createElement('button'); b.textContent=t; b.className='ct-btn'; b.onclick=()=>{ content.style.textAlign=v; scheduleLayout(); emitCaptionState('align'); }; return b; }; pop.appendChild(mk('L','left')); pop.appendChild(mk('C','center')); pop.appendChild(mk('R','right')); }); };

    // More (padding + duplicate/lock/delete hooks if present)
    moreBtn.onclick = (e)=>{
      openPopover(e.currentTarget, (pop)=>{
        const padL=document.createElement('div'); padL.textContent='Padding'; padL.style.margin='0 0 4px';
        const pad=document.createElement('input'); pad.type='range'; pad.min='0'; pad.max='48'; pad.step='1'; pad.value=String(parseInt(getComputedStyle(content).paddingLeft,10)||12);
        pad.oninput=()=>{ const v=parseInt(pad.value,10)||0; content.style.padding=`${v}px`; };
        pad.onchange=()=>{ scheduleLayout(); emitCaptionState('padding'); };
        const row=document.createElement('div'); row.style.display='flex'; row.style.gap='6px'; row.style.marginTop='8px';
        const mk=(t)=>{ const b=document.createElement('button'); b.textContent=t; b.className='ct-btn'; return b; };
        const dup=mk('Duplicate'), lock=mk('Lock'), del=mk('Delete');
        dup.onclick=()=>{ try { if (window.duplicateCaption) window.duplicateCaption(box); } catch {} };
        lock.onclick=()=>{ try { if (window.lockCaption) window.lockCaption(box,true); } catch {} };
        del.onclick=()=>{ try { if (window.deleteCaption) window.deleteCaption(box); } catch {} };
        row.appendChild(dup); row.appendChild(lock); row.appendChild(del);
        pop.appendChild(padL); pop.appendChild(pad); pop.appendChild(row);
      });
    };
  }


  // Get variant-specific family name based on weight and style (mirrors server logic)
  function getVariantFamily(weightCss, fontStyle) {
    // Always return base family - browser selects variant via weight/style descriptors
    return 'DejaVu Sans';
  }

  // Emit unified caption state to live preview system
  function emitCaptionState(reason = 'toolbar') {
    // Get frame dimensions FIRST (before any usage)
    const { W: frameW, H: frameH } = window.CaptionGeom.getFrameDims();
    
    // Get fresh rects AFTER any snap/drag
    const stageRect = stage.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const cs = getComputedStyle(content);
    
    // Parse stroke from webkitTextStroke: "3px rgba(0,0,0,0.85)"
    const parseStroke = (str) => {
      if (!str || str === 'none' || str === '0px') return { px: 0, color: 'rgba(0,0,0,0.85)' };
      const match = str.match(/^([\d.]+)px\s+(.+)$/);
      return match ? { px: parseFloat(match[1]), color: match[2] } : { px: 0, color: 'rgba(0,0,0,0.85)' };
    };
    
    const stroke = parseStroke(cs.webkitTextStroke || cs.textStroke);
    const shadow = window.CaptionGeom.parseShadow(cs.textShadow);
    // Convert to legacy format for state
    const shadowData = { x: 0, y: shadow.y, blur: shadow.blur, color: 'rgba(0,0,0,0.6)' };
    
    // Read ACTUAL computed values from browser (visual truth)
    const fontFamily = (cs.fontFamily || 'DejaVu Sans').split(',')[0].replace(/['"]/g, '').trim();
    const fontPx = parseInt(cs.fontSize, 10);
    
    // Debug logging to track fontSize being emitted
    console.log('[emitCaptionState]', {
      reason,
      fontPx,
      boxW: Math.round(box.clientWidth),
      boxH: Math.round(box.clientHeight),
      contentFontSize: cs.fontSize,
      computedFontSize: parseFloat(cs.fontSize)
    });
    const lineHeightRaw = cs.lineHeight;
    const lineHeightPx = lineHeightRaw === 'normal' 
      ? Math.round(fontPx * 1.2) 
      : parseFloat(lineHeightRaw);
    const lineSpacingPx = Math.max(0, Math.round(lineHeightPx - fontPx));
    const letterSpacingPx = parseFloat(cs.letterSpacing) || 0;
    // Normalize weight to numeric tokens (400/700) for server consistency
    const rawWeight = String(cs.fontWeight);
    const weightCss = (rawWeight === 'bold' || parseInt(rawWeight, 10) >= 600) ? '700' : '400';
    const fontStyle = cs.fontStyle === 'italic' ? 'italic' : 'normal';
    const textAlign = cs.textAlign || 'center';
    const textTransform = cs.textTransform || 'none';
    
    // Cache successful DOM extraction for stable extraction reuse
    const text = (content.innerText || content.textContent || '').replace(/\s+/g, ' ').trim();
    
    // Extract actual line breaks as rendered by browser
    const lines = extractRenderedLines(content);
    if (lines.length === 0) {
      console.error('[emitCaptionState] No valid lines extracted');
      return;
    }
    
    // Build exact font string the browser used with variant-specific family
    const family = getVariantFamily(weightCss, fontStyle);
    const previewFontString = `${fontStyle} ${weightCss === '700' ? 'bold' : 'normal'} ${fontPx}px "${family}"`;
    
    // AUDIT: Log toolbar font construction
    console.info('[AUDIT:CLIENT:toolbar]', {
      previewFontString,
      fontFamily: family,
      weightCss,
      fontStyle,
      sample: text.slice(0, 60)
    });
    lastGoodDOMCache = {
      text,
      lines: lines,
      contentWidth: content.clientWidth,
      fontPx: fontPx,
      lineSpacingPx: lineSpacingPx,
      timestamp: Date.now()
    };
    
    // Color & effects
    const color = cs.color || 'rgb(255,255,255)';
    const opacity = parseFloat(cs.opacity) || 1;
    
    // Geometry: tight to rendered text + visible padding
    const cssPaddingLeft = parseInt(cs.paddingLeft, 10) || 0;
    const cssPaddingRight = parseInt(cs.paddingRight, 10) || 0;
    const cssPaddingTop = parseInt(cs.paddingTop, 10) || 0;
    const cssPaddingBottom = parseInt(cs.paddingBottom, 10) || 0;

    // If user dragged box taller/wider, preserve that airy look
    const contentTextW = content.scrollWidth;
    const contentTextH = content.scrollHeight;
    const boxInnerW = box.clientWidth;
    const boxInnerH = box.clientHeight;

    // rasterPadding: use the visual padding the user sees
    const rasterPaddingX = Math.max(cssPaddingLeft, cssPaddingRight, 
      Math.round((boxInnerW - contentTextW) / 2));
    const rasterPaddingY = Math.max(cssPaddingTop, cssPaddingBottom,
      Math.round((boxInnerH - contentTextH) / 2));

    // Use actual DOM height for totalTextH (includes line-height effects)
    const totalTextH = Math.round(content.getBoundingClientRect().height);
    
    // Raster dimensions: text + padding (what user sees)
    const wPx = Math.round((boxRect.width / stageRect.width) * frameW);
    const rasterW = wPx;
    
    // Use shared helper for rasterH
    const rasterH = window.CaptionGeom.computeRasterH({
      totalTextH,
      padTop: cssPaddingTop,
      padBottom: cssPaddingBottom,
      shadowBlur: shadow.blur,
      shadowOffsetY: shadow.y
    });
    const rasterPadding = Math.round((cssPaddingTop + cssPaddingBottom) / 2); // average for legacy
    
    // Position: box top-left in frame space (no %) - compute from fresh rects
    const yPct = (boxRect.top - stageRect.top) / stageRect.height;
    
    // Compute xPct and wPct from fresh rects too
    const xPct = (boxRect.left - stageRect.left) / stageRect.width;
    const wPct = boxRect.width / stageRect.width;
    
    // Frame dimensions already obtained at function start
    
    // Compute absolute pixel positions with proper clamping and rounding
    const xPctClamped = Math.max(0, Math.min(1, xPct));
    const xPx_png = Math.round(xPctClamped * frameW);
    const yPx_png = Math.round(yPct * frameH);
    
    
    console.log('[geom:yPx_png]', {
      boxTop: boxRect.top,
      stageTop: stageRect.top,
      stageHeight: stageRect.height,
      yPct,
      yPx_png,
      placement: window.currentPlacement,
      frameH
    });
    
    console.log('[geom:xPx_png]', {
      stageWidth: stageRect.width,
      xPct,
      xPx_png,
      frameW
    });
    
    const xExpr_png = (textAlign === 'center') ? '(W-overlay_w)/2'
      : (textAlign === 'right') ? '(W-overlay_w)'
      : '0';
    
    // Determine mode based on geometry state
    const mode = geometryDirty ? 'dom' : (savedPreview ? 'raster' : 'dom');
    
    // Log mode switch for debugging
    if (mode === 'dom') {
      console.log('[overlay-live] switched to DOM (geometry dirty or no saved preview)');
    } else {
      console.log('[overlay-live] switched to RASTER (saved preview active)');
    }
    
    const state = {
      // Typography (browser truth)
      fontFamily,
      fontPx,
      lineSpacingPx,
      letterSpacingPx,
      weightCss,
      fontStyle,
      textAlign,
      textTransform,
      previewFontString, // CRITICAL: exact font string browser used
      
      // Color & effects
      color,
      opacity,
      strokePx: stroke.px,
      strokeColor: stroke.color,
      shadowColor: shadowData.color,
      shadowBlur: shadowData.blur,
      shadowOffsetX: shadowData.x,
      shadowOffsetY: shadowData.y,
      
      // Geometry (frame-space pixels, authoritative)
      frameW,
      frameH,
      rasterW,
      rasterH,
      totalTextH,
      rasterPadding,
      rasterPaddingX,
      rasterPaddingY,
      xPct,
      yPct,
      wPct,
      yPx_png,
      xPx_png,      // NEW: absolute X position (clamped)
      xExpr_png,    // KEEP: fallback expression
      
      // Line breaks (browser truth)
      lines: lines,
      
      // Metadata
      text: content.textContent || '',
      textRaw: content.textContent || '',
      ssotVersion: 3,
      mode: mode,  // Dynamic instead of hardcoded 'raster'
      reason
    };
    
    // Guard against NaN/null
    Object.keys(state).forEach(k => {
      if (typeof state[k] === 'number' && !Number.isFinite(state[k])) {
        console.warn(`[emitCaptionState] Invalid number for ${k}:`, state[k]);
        state[k] = 0;
      }
    });
    
    console.log('[geom:client]', {
      fontPx, lineSpacingPx, letterSpacingPx, 
      rasterW, rasterPadding, totalTextH, rasterH,
      xExpr_png, yPx_png, frameW, frameH, 
      linesLen: lines.length
    });
    
    // Store and emit
    window.__overlayMeta = state;
    if (typeof window.updateCaptionState === 'function') {
      window.updateCaptionState(state);
    }
  }

  // Expose emitCaptionState globally so handlers defined elsewhere can call it
  window.emitCaptionState = emitCaptionState;

  // Snap box to placement preset (placement dropdown helper)
  function snapToPlacement(placement) {
    // Get current metrics from DOM
    const stageRect = stage.getBoundingClientRect();
    const cs = getComputedStyle(content);
    
    // Use actual rendered height for totalTextH
    const totalTextH = Math.round(content.getBoundingClientRect().height);
    const padTop = parseInt(cs.paddingTop, 10) || 0;
    const padBottom = parseInt(cs.paddingBottom, 10) || 0;
    const shadow = window.CaptionGeom.parseShadow(cs.textShadow);
    
    // Compute rasterH using shared helper
    const rH = window.CaptionGeom.computeRasterH({
      totalTextH,
      padTop,
      padBottom,
      shadowBlur: shadow.blur,
      shadowOffsetY: shadow.y
    });
    
    // Get frame dimensions from meta
    const { H: FRAME_H } = window.CaptionGeom.getFrameDims();
    
    // Compute target y in frame space
    const targetYPx = window.CaptionGeom.computeYPxFromPlacement(placement, rH);
    
    // Map frame px to stage css px
    const pxFrameToStage = stageRect.height / FRAME_H;
    const cssTop = Math.round(targetYPx * pxFrameToStage);
    
    box.style.top = `${cssTop}px`;
    window.currentPlacement = placement;
    
    // Trigger state emit to persist new position
    emitCaptionState('snap');
  }

  // Expose snap API globally
  window.OverlayAPI = { snapToPlacement };
}

export function getCaptionMeta(){ 
  if (typeof window.getCaptionMeta === 'function') {
    return window.getCaptionMeta(); 
  }
  console.warn('[caption-overlay] getCaptionMeta called before initCaptionOverlay');
  return null;
}

export function applyCaptionMeta(meta){ 
  if (typeof window.applyCaptionMeta === 'function') {
    return window.applyCaptionMeta(meta); 
  }
  console.warn('[caption-overlay] applyCaptionMeta called before initCaptionOverlay');
  return false;
}

export function setQuote(text){ 
  if (typeof window.setQuote === 'function') {
    return window.setQuote(text); 
  }
  console.warn('[caption-overlay] setQuote called before initCaptionOverlay');
  return false;
}

// Export flag setters for external use
export function markPreviewSaved() {
  savedPreview = true;
  geometryDirty = false;
}

export function markGeometryDirty() {
  geometryDirty = true;
  savedPreview = false;
}

// Export the line extraction function for shared use
export function extractRenderedLines(element) {
  const text = element.textContent || '';
  if (!text.trim()) return [];
  
  // Primary: Use Range API to detect line boxes
  try {
    const range = document.createRange();
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    
    const lines = [];
    let currentLine = '';
    let lastBottom = null;
    
    let textNode;
    while (textNode = walker.nextNode()) {
      const nodeText = textNode.textContent;
      for (let i = 0; i < nodeText.length; i++) {
        range.setStart(textNode, i);
        range.setEnd(textNode, i + 1);
        const rects = range.getClientRects();
        if (rects.length > 0) {
          const rect = rects[0];
          if (lastBottom !== null && rect.bottom > lastBottom + 2) {
            // Line break detected
            if (currentLine.trim()) lines.push(currentLine.trim());
            currentLine = nodeText[i];
          } else {
            currentLine += nodeText[i];
          }
          lastBottom = rect.bottom;
        }
      }
    }
    if (currentLine.trim()) lines.push(currentLine.trim());
    
    if (lines.length > 0) {
      console.log('[extractLines] DOM method:', lines.length, 'lines');
      return lines;
    }
  } catch (e) {
    console.warn('[extractLines] DOM method failed:', e);
  }
  
  // Fallback: Canvas measurement (only if DOM fails)
  const cs = getComputedStyle(element);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  
  const maxWidth = element.clientWidth - parseInt(cs.paddingLeft, 10) - parseInt(cs.paddingRight, 10);
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  
  console.log('[extractLines] Canvas fallback:', lines.length, 'lines');
  return lines;
}

// Cache for stable line extraction
let lastGoodDOMCache = null;

// Stable line extraction with retry, caching, and proper fallback
export function extractLinesStable(content, metrics) {
  const text = (content.innerText || content.textContent || '').replace(/\s+/g, ' ').trim();
  if (!text) return { lines: [], source: 'empty' };
  
  // Check font/layout readiness
  if (document.fonts.status !== 'loaded') {
    console.warn('[extractLinesStable] Fonts not ready, retrying...');
    return { lines: [], source: 'fonts-not-ready' };
  }
  
  if (content.offsetParent === null) {
    console.warn('[extractLinesStable] Element not laid out, retrying...');
    return { lines: [], source: 'not-laid-out' };
  }
  
  // Try DOM method first
  const domResult = tryDOMExtraction(content);
  if (domResult.lines.length > 0) {
    // Cache successful DOM result
    lastGoodDOMCache = {
      text,
      lines: domResult.lines,
      contentWidth: content.clientWidth,
      fontPx: metrics.fontPx,
      lineSpacingPx: metrics.lineSpacingPx,
      timestamp: Date.now()
    };
    return { lines: domResult.lines, source: 'dom' };
  }
  
  // Try DOM with retry (up to 2x requestAnimationFrame)
  for (let attempt = 1; attempt <= 2; attempt++) {
    // Use synchronous rAF for now - can be made async later if needed
    const retryResult = tryDOMExtraction(content);
    if (retryResult.lines.length > 0) {
      lastGoodDOMCache = {
        text,
        lines: retryResult.lines,
        contentWidth: content.clientWidth,
        fontPx: metrics.fontPx,
        lineSpacingPx: metrics.lineSpacingPx,
        timestamp: Date.now()
      };
      return { lines: retryResult.lines, source: 'dom-retry' };
    }
  }
  
  // Check cache for reuse
  if (lastGoodDOMCache && 
      lastGoodDOMCache.text === text &&
      Math.abs(lastGoodDOMCache.contentWidth - content.clientWidth) <= 1 &&
      Math.abs(lastGoodDOMCache.fontPx - metrics.fontPx) <= 1 &&
      Math.abs(lastGoodDOMCache.lineSpacingPx - metrics.lineSpacingPx) <= 1) {
    console.log('[extractLinesStable] Using cached DOM result');
    return { lines: lastGoodDOMCache.lines, source: 'dom-cached' };
  }
  
  // Fallback to canvas with proper content box measurement
  const canvasResult = tryCanvasExtraction(content, metrics);
  return { lines: canvasResult.lines, source: 'canvas' };
}

// DOM extraction helper
function tryDOMExtraction(element) {
  try {
    const range = document.createRange();
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    
    const lines = [];
    let currentLine = '';
    let lastBottom = null;
    
    let textNode;
    while (textNode = walker.nextNode()) {
      const nodeText = textNode.textContent;
      for (let i = 0; i < nodeText.length; i++) {
        range.setStart(textNode, i);
        range.setEnd(textNode, i + 1);
        const rects = range.getClientRects();
        if (rects.length > 0) {
          const rect = rects[0];
          if (lastBottom !== null && rect.bottom > lastBottom + 2) {
            if (currentLine.trim()) lines.push(currentLine.trim());
            currentLine = nodeText[i];
          } else {
            currentLine += nodeText[i];
          }
          lastBottom = rect.bottom;
        }
      }
    }
    if (currentLine.trim()) lines.push(currentLine.trim());
    
    return { lines, success: lines.length > 0 };
  } catch (e) {
    console.warn('[tryDOMExtraction] DOM method failed:', e);
    return { lines: [], success: false };
  }
}

// Canvas extraction helper with proper content box measurement
function tryCanvasExtraction(element, metrics) {
  const cs = getComputedStyle(element);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // Use exact font string from computed styles
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  
  // Calculate content box width (clientWidth - padding)
  const padL = parseInt(cs.paddingLeft, 10) || 0;
  const padR = parseInt(cs.paddingRight, 10) || 0;
  const maxWidth = element.clientWidth - padL - padR;
  
  if (maxWidth <= 0) {
    console.warn('[tryCanvasExtraction] Invalid maxWidth:', maxWidth);
    return { lines: [], success: false };
  }
  
  const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  
  return { lines, success: true };
}

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
