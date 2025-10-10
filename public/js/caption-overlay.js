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

  // V2 sticky-bounds fitter state (align with server clamps)
  const MIN_PX = 12, MAX_PX = 200;
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

  // V2-only floating toolbar DOM
  let toolbar = null; let toolbarArrow = null; let toolbarMode = 'inside';
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

    // Arrow for outside docking
    toolbarArrow = document.createElement('div'); toolbarArrow.className='ct-arrow'; toolbar.appendChild(toolbarArrow);

    // Attach now (hidden until editing)
    try { box.appendChild(toolbar); toolbar.style.display='none'; } catch {}

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
    .caption-box .content{ padding:28px 12px 12px 12px; outline:none; white-space:pre-wrap; word-break:normal; overflow-wrap:normal; hyphens:none; overflow:hidden; box-sizing:border-box;
      color:#fff; text-align:center; font-weight:800; font-size:38px; line-height:1.15; text-shadow:0 2px 12px rgba(0,0,0,.65);
      font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
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

  // Toolbar CSS (separate style for minimal diff)
  if (overlayV2) {
    const style2 = document.createElement('style');
    style2.textContent = `
      .caption-toolbar{ position:absolute; top:6px; left:32px; display:flex; gap:6px; align-items:center; padding:6px 8px;
        background:rgba(24,24,27,.55); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
        color:#fff; border-radius:10px; box-shadow:0 4px 16px rgba(0,0,0,.35); z-index:100000; pointer-events:auto; }
      .caption-toolbar .ct-row{ display:flex; gap:6px; align-items:center; }
      .caption-toolbar .ct-btn{ min-width:0; height:24px; padding:0 8px; border-radius:6px; border:1px solid rgba(255,255,255,.15);
        background:rgba(255,255,255,.08); color:#fff; font: 12px/1 system-ui; letter-spacing:.02em; cursor:pointer; }
      .caption-toolbar .ct-btn:hover{ background:rgba(255,255,255,.16); }
      .caption-toolbar[data-mode="inside"] .ct-arrow{ display:none; }
      .caption-toolbar[data-mode="outside"] .ct-arrow{ position:absolute; width:10px; height:10px; background:inherit; transform:rotate(45deg); box-shadow:inherit; }
      .caption-box.always-handle .caption-toolbar{ opacity:0; pointer-events:none; }
      .caption-box.always-handle.editing .caption-toolbar{ opacity:1; pointer-events:auto; }
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
    `;
    document.head.appendChild(style2);
  }

  // Snap into view on next frame to avoid off-viewport placement
  try { requestAnimationFrame(() => { try { ensureOverlayTopAndVisible(stageSel); } catch {} }); } catch {}

  // Ensure content.maxWidth defaults to 100% (prevents narrow pixel constraints)
  if (overlayV2) {
    content.style.maxWidth = '100%';
  }

  // Drag behavior (strict: only move while actively dragging)
  let drag = null; let dragging = false;
  handle.addEventListener('pointerdown', (e)=>{
    const s = stage.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    drag = { startX: e.clientX, startY: e.clientY, ox: b.left - s.left, oy: b.top - s.top, sw: s.width, sh: s.height, bw: b.width, bh: b.height };
    handle.setPointerCapture(e.pointerId);
    dragging = true;
    box.classList.add('is-dragging');
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
    handle.addEventListener('pointerup', ()=> { dragging = false; drag = null; box.classList.remove('is-dragging'); }, { passive: true });
    handle.addEventListener('pointercancel', ()=> { dragging = false; drag = null; box.classList.remove('is-dragging'); }, { passive: true });
  }

  // Keep inside frame on resize and clamp to stage
  const clamp = ()=>{
    if (overlayV2) return; // V2 mode uses percentage-based positioning via applyCaptionMeta
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

  // Toolbar placement (V2 only)
  function placeToolbar(){
    if (!overlayV2 || !toolbar) return;
    const s = stage.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const insideOk = (b.width >= 220) && (b.height >= 70);
    const compact = b.width < 120 ? 2 : (b.width < 180 ? 1 : 0);
    toolbar.dataset.compact = String(compact);
    const nextMode = insideOk ? 'inside' : 'outside';
    if (nextMode !== toolbarMode) {
      toolbarMode = nextMode; toolbar.dataset.mode = toolbarMode;
      try { if (toolbarMode === 'inside') { if (!box.contains(toolbar)) box.appendChild(toolbar); } else { if (!stage.contains(toolbar)) stage.appendChild(toolbar); } } catch {}
    }
    if (toolbarMode === 'inside') {
      toolbar.style.position = 'absolute'; toolbar.style.left = '32px'; toolbar.style.top = '6px'; toolbar.style.transform = 'none';
    } else {
      const pad = 6;
      let left = b.left - s.left + pad;
      let top  = b.top  - s.top  - 8 - (toolbar.offsetHeight || 30);
      let arrowAt = 'down';
      if (top < 0) { top = b.bottom - s.top + 8; arrowAt = 'up'; }
      left = Math.max(4, Math.min(left, s.width - (toolbar.offsetWidth || 180) - 4));
      top  = Math.max(4, Math.min(top,  s.height - (toolbar.offsetHeight || 30) - 4));
      toolbar.style.position = 'absolute';
      toolbar.style.left = `${Math.round(left)}px`;
      toolbar.style.top  = `${Math.round(top)}px`;
      if (toolbarArrow) {
        const ax = Math.max(10, Math.min((b.left - s.left + 10) - left, (toolbar.offsetWidth || 180) - 10));
        if (arrowAt === 'down') { toolbarArrow.style.left = `${Math.round(ax)}px`; toolbarArrow.style.top = `${(toolbar.offsetHeight||30)-5}px`; }
        else { toolbarArrow.style.left = `${Math.round(ax)}px`; toolbarArrow.style.top = `-5px`; }
      }
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
      try { toolbar.style.display = editing ? 'flex' : 'none'; } catch {}
      try { requestAnimationFrame(()=>{ placeToolbar(); }); } catch {}
    }
  }
  
  // Click outside to exit editing mode (clean preview)
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
    // Ensure wrapping respects the available inner width
    content.style.maxWidth = maxW + 'px';
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
    // Hysteresis: require >2px delta to flip direction on either axis
    const expandX = b.width  > v2State.lastBoxW + 2;
    const shrinkX = b.width  < v2State.lastBoxW - 2;
    const expandY = b.height > v2State.lastBoxH + 2;
    const shrinkY = b.height < v2State.lastBoxH - 2;
    const expanding = (expandX || expandY) && !(shrinkX || shrinkY);
    const currentPx = parseInt(s.fontSize, 10) || MIN_PX;
    try { if (window.__overlayV2 && window.__debugOverlay) console.log(JSON.stringify({ tag:'fit:start', reason, lowPx: v2State.fitBounds.lowPx, highPx: v2State.fitBounds.highPx, currentPx })); } catch {}
    const basis = v2State.fitBounds.lastGoodPx || currentPx;
    if (expanding) {
      v2State.fitBounds.lowPx  = Math.max(v2State.fitBounds.lowPx, basis);
      v2State.fitBounds.highPx = Math.min(MAX_PX, Math.max(v2State.fitBounds.highPx, Math.ceil(basis * 2)));
    } else {
      v2State.fitBounds.highPx = Math.min(v2State.fitBounds.highPx, basis);
      v2State.fitBounds.lowPx  = Math.max(MIN_PX, Math.min(v2State.fitBounds.lowPx, Math.floor(basis / 2)));
    }
    let lo = Math.max(MIN_PX, v2State.fitBounds.lowPx);
    let hi = Math.min(MAX_PX, v2State.fitBounds.highPx);
    let best = Math.round(v2State.fitBounds.lastGoodPx || lo);
    for (let i = 0; i < 8 && lo <= hi; i++) {
      const mid = (lo + hi) >> 1;
      content.style.fontSize = mid + 'px';
      content.style.maxWidth = maxW + 'px';
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
    if (typeof meta.wPct === 'number') box.style.width  = (meta.wPct * 100) + '%';
    if (typeof meta.hPct === 'number') box.style.height = (meta.hPct * 100) + '%';
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
        ['Inter','Roboto','Segoe UI','System UI','DejaVu Sans','Arial','Georgia'].forEach(f=>{ const o=document.createElement('option'); o.value=f; o.textContent=f; fam.appendChild(o); });
        fam.value = (getComputedStyle(content).fontFamily||'').split(',')[0].replaceAll('"','').trim();
        fam.onchange = ()=>{ content.style.fontFamily = fam.value + ', system-ui, -apple-system, Segoe UI, Roboto, sans-serif'; scheduleLayout(); };
        const lhL = document.createElement('div'); lhL.textContent='Line height'; lhL.style.margin='6px 0 2px';
        const lh = document.createElement('input'); lh.type='range'; lh.min='0.9'; lh.max='2.0'; lh.step='0.05'; lh.value=String(parseFloat(getComputedStyle(content).lineHeight)||1.15);
        lh.oninput = ()=>{ content.style.lineHeight = String(lh.value); };
        lh.onchange = ()=>{ scheduleLayout(); };
        const lsL = document.createElement('div'); lsL.textContent='Letter spacing'; lsL.style.margin='6px 0 2px';
        const ls = document.createElement('input'); ls.type='range'; ls.min='-1'; ls.max='6'; ls.step='0.5'; ls.value=String(parseFloat(getComputedStyle(content).letterSpacing)||0);
        ls.oninput = ()=>{ content.style.letterSpacing = `${ls.value}px`; };
        ls.onchange = ()=>{ scheduleLayout(); };
        pop.appendChild(fam); pop.appendChild(lhL); pop.appendChild(lh); pop.appendChild(lsL); pop.appendChild(ls);
      });
    };

    // Size
    decBtn.onclick = ()=>{ const v = Math.max(12,(parseInt(getComputedStyle(content).fontSize,10)||24)-2); content.style.fontSize=v+'px'; scheduleLayout(); };
    incBtn.onclick = ()=>{ const v = Math.min(200,(parseInt(getComputedStyle(content).fontSize,10)||24)+2); content.style.fontSize=v+'px'; scheduleLayout(); };

    // Bold/Italic
    boldBtn.onclick = ()=>{ const w=getComputedStyle(content).fontWeight; content.style.fontWeight=(w==='700'||parseInt(w,10)>=600)?'400':'700'; scheduleLayout(); };
    italicBtn.onclick = ()=>{ const fs=getComputedStyle(content).fontStyle; content.style.fontStyle=(fs==='italic')?'normal':'italic'; scheduleLayout(); };

    // Color / stroke / shadow (paint-only)
    colorBtn.onclick = (e)=>{
      openPopover(e.currentTarget, (pop)=>{
        const color = document.createElement('input'); color.type='color'; color.value='#ffffff'; color.style.width='100%'; color.oninput=()=>{ content.style.color=color.value; };
        const stroke = document.createElement('input'); stroke.type='range'; stroke.min='0'; stroke.max='6'; stroke.step='1'; stroke.value='0'; stroke.style.width='100%';
        stroke.oninput = ()=>{ const sw=parseInt(stroke.value,10)||0; content.style.webkitTextStroke = sw?`${sw}px #000`:''; };
        const sh = document.createElement('input'); sh.type='range'; sh.min='0'; sh.max='24'; sh.step='1'; sh.value='12'; sh.style.width='100%';
        sh.oninput = ()=>{ const n=parseInt(sh.value,10)||0; content.style.textShadow = n?`0 2px ${Math.round(n)}px rgba(0,0,0,.65)`:'none'; };
        pop.appendChild(color); pop.appendChild(stroke); pop.appendChild(sh);
      });
    };

    // Opacity (paint-only)
    opBtn.onclick = (e)=>{ openPopover(e.currentTarget, (pop)=>{ const op=document.createElement('input'); op.type='range'; op.min='0'; op.max='1'; op.step='0.05'; op.value=String(parseFloat(getComputedStyle(content).opacity)||1); op.oninput=()=>{ content.style.opacity=String(op.value); }; pop.appendChild(op); }); };

    // Align
    alignBtn.onclick = (e)=>{ openPopover(e.currentTarget, (pop)=>{ const mk=(t,v)=>{ const b=document.createElement('button'); b.textContent=t; b.className='ct-btn'; b.onclick=()=>{ content.style.textAlign=v; scheduleLayout(); }; return b; }; pop.appendChild(mk('L','left')); pop.appendChild(mk('C','center')); pop.appendChild(mk('R','right')); }); };

    // More (padding + duplicate/lock/delete hooks if present)
    moreBtn.onclick = (e)=>{
      openPopover(e.currentTarget, (pop)=>{
        const padL=document.createElement('div'); padL.textContent='Padding'; padL.style.margin='0 0 4px';
        const pad=document.createElement('input'); pad.type='range'; pad.min='0'; pad.max='48'; pad.step='1'; pad.value=String(parseInt(getComputedStyle(content).paddingLeft,10)||12);
        pad.oninput=()=>{ const v=parseInt(pad.value,10)||0; content.style.padding=`${v}px`; };
        pad.onchange=()=>{ scheduleLayout(); };
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
