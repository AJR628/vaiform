/**
 * Draggable Caption Overlay System
 * Provides draggable, resizable caption overlay with style controls.
 * Exposes: initCaptionOverlay, getCaptionMeta, applyCaptionMeta, setQuote
 */

export function initCaptionOverlay({ stageSel = '#stage', mediaSel = '#previewMedia' } = {}) {
  const stage = document.querySelector(stageSel);
  if (!stage) throw new Error('stage not found');
  
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

  box.appendChild(handle);
  box.appendChild(content);
  stage.appendChild(box);

  // Style (inline so we don't require new CSS file)
  const style = document.createElement('style');
  style.textContent = `
    .caption-stage{ position:relative; border-radius:12px; overflow:hidden }
    .caption-stage img,.caption-stage video{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; pointer-events:none }
    .caption-box{ position:absolute; resize:both; overflow:auto; outline:1.5px dashed rgba(255,255,255,.45);
      border-radius:12px; z-index:9999; touch-action:none; }
    .caption-box .drag-handle{ cursor:move; user-select:none; padding:6px 10px; background:rgba(0,0,0,.25);
      border-top-left-radius:12px; border-top-right-radius:12px; font: 12px/1 system-ui; letter-spacing:.08em; text-transform:uppercase; }
    .caption-box .content{ padding:10px 12px; outline:none; white-space:pre-wrap; word-break:break-word;
      color:#fff; text-align:center; font-weight:800; font-size:38px; line-height:1.15; text-shadow:0 2px 12px rgba(0,0,0,.65);
      font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  `;
  document.head.appendChild(style);

  // Snap into view on next frame to avoid off-viewport placement
  try { requestAnimationFrame(() => { try { ensureOverlayTopAndVisible(stageSel); } catch {} }); } catch {}

  // Drag behavior
  let drag = null;
  handle.addEventListener('pointerdown', (e)=>{
    const s = stage.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    drag = { startX: e.clientX, startY: e.clientY, ox: b.left - s.left, oy: b.top - s.top, sw: s.width, sh: s.height, bw: b.width, bh: b.height };
    handle.setPointerCapture(e.pointerId);
    try {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      console.log('[overlay] pointerdown at', e.clientX, e.clientY, 'elementUnder', el?.tagName, el?.id || el?.className || '');
    } catch {}
  });
  
  const onMove = (e)=>{
    if(!drag) return;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    let x = Math.max(0, Math.min(drag.ox + dx, drag.sw - drag.bw));
    let y = Math.max(0, Math.min(drag.oy + dy, drag.sh - drag.bh));
    box.style.left = (x / drag.sw * 100) + '%';
    box.style.top  = (y / drag.sh * 100) + '%';
  };
  
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', ()=> drag=null);
  handle.addEventListener('pointercancel', ()=> drag=null);

  // Keep inside frame on resize
  const clamp = ()=>{
    const s = stage.getBoundingClientRect(), b = box.getBoundingClientRect();
    let x = Math.max(0, Math.min(b.left - s.left, s.width - b.width));
    let y = Math.max(0, Math.min(b.top  - s.top,  s.height - b.height));
    box.style.left = (x / s.width * 100) + '%';
    box.style.top  = (y / s.height * 100) + '%';
    box.style.width  = Math.min(b.width,  s.width) + 'px';
    box.style.height = Math.min(b.height, s.height) + 'px';
  };
  new ResizeObserver(clamp).observe(box);
  window.addEventListener('resize', clamp);

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
  content.addEventListener('input', ()=> shrinkToFit(content, box));
  new ResizeObserver(()=> shrinkToFit(content, box)).observe(box);

  // Public API on window (simple)
  window.getCaptionMeta = function getCaptionMeta(){
    const s = stage.getBoundingClientRect(), b = box.getBoundingClientRect(), cs = getComputedStyle(content);
    return {
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
      fontFamily: cs.fontFamily
    };
  };
  
  window.applyCaptionMeta = function applyCaptionMeta(meta){
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
    shrinkToFit(content, box);
  };
  
  window.setQuote = function setQuote(text){ 
    content.innerText = text || ''; 
    shrinkToFit(content, box); 
    try { ensureOverlayTopAndVisible(stageSel); } catch {}
  };
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
