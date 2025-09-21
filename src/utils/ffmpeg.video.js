import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { renderImageQuoteVideo } from "./ffmpeg.js";
import { getDurationMsFromMedia } from "./media.duration.js";
import { CAPTION_OVERLAY } from "../config/env.js";

// --- Caption render parity with preview ---
const CAPTION_FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const CAPTION_FONT_REG  = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

// Match preview look: slightly higher outline + soft drop shadow
const CAPTION_ALPHA     = 0.80;   // white text opacity (preview uses ~80%)
const STROKE_ALPHA      = 0.85;   // dark outline opacity
const STROKE_W          = 3;      // outline width - matches preview styling
const SHADOW_ALPHA      = 0.55;   // drop shadow opacity
const SHADOW_X          = 0;      // no horizontal shift (keeps symmetry)
const SHADOW_Y          = 2;      // slight vertical softness
const BOX_BG_ALPHA      = 0.00;   // keep disabled unless user checks "Show box"

// text/path helpers
const esc = s => String(s).replace(/\\/g,'\\\\').replace(/:/g,'\\:').replace(/,/g,'\\,').replace(/;/g,'\\;').replace(/\[/g,'\\[').replace(/\]/g,'\\]').replace(/'/g,"\\'");
function escText(s) {
  // Escape EVERYTHING ffmpeg might interpret inside drawtext text=...
  return String(s)
    .replace(/\\/g, '\\\\')   // backslash first
    .replace(/'/g, "\\'")     // apostrophe
    .replace(/:/g, '\\:')     // option separator
    .replace(/,/g, '\\,')     // filter separator
    .replace(/;/g, '\\;')     // filterchain separator
    .replace(/\[/g, '\\[')    // label delimiters
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')    // expression args
    .replace(/\)/g, '\\)')
    .replace(/%/g, '\\%');    // format tokens
}

function escFF(text) {
  if (!text) return "";
  // Escape chars that break ffmpeg expressions
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

// Escapes text for FFmpeg drawtext (filter-syntax, not shell)
function escapeForDrawtext(s = '') {
  return String(s)
    // order matters; escape backslash first
    .replace(/\\/g, '\\\\')
    // characters that break option parsing in drawtext:
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/%/g, '\\%')
    // quotes & newlines
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, '\\n');
}
export function sanitizeFilter(graph) {
  const s = String(graph);
  // Protect quoted substrings so we don't touch spaces/newlines inside drawtext text='...'
  const stash = [];
  const protectedS = s.replace(/'[^']*'/g, (m) => { stash.push(m); return `__Q${stash.length - 1}__`; });
  const cleaned = protectedS
    .split(';')
    .map(seg => seg.trim())
    .filter(Boolean)
    .map(seg => seg.replace(/\s{2,}/g, ' '))
    .join(';')
    .replace(/;{2,}/g, ';');
  return cleaned.replace(/__Q(\d+)__/g, (_, i) => stash[Number(i)]);
}

// safe builders
export function joinF(parts) {
  return (parts || [])
    .flatMap(p => Array.isArray(p) ? p : [p])
    .map(p => (p ?? '').trim())
    .filter(Boolean)
    .join(',');
}
const joinFilters = (arr) => (arr || []).filter(Boolean).join(',');
const inL  = (l) => (l ? `[${l}]` : '');
const outL = (l) => (l ? ` [${l}]` : ''); // NOTE: leading space, not comma
const makeChain = (inputLabel, filters, outputLabel) => `${inL(inputLabel)}${joinFilters(filters)}${outL(outputLabel)}`;

// --- Caption layout helper -----------------------------------------------
// Wrap captions into 1–2 lines that fit inside safe margins, then return
// { text, fontsize, yExpr }. Works with DejaVuSans; charWidth ~ 0.58 * fz.
function wrapCaption(raw, w, h, opts = {}) {
  const {
    maxLines = 2,
    fontMax = 64,         // starting size; we’ll step down if needed
    fontMin = 28,         // hard floor
    marginX = 0.08,       // 8% left/right safe area
    marginBottom = 0.12,  // 12% bottom safe area
    charW = 0.58,         // DejaVuSans avg glyph width factor
    lineSpacingFactor = 0.25,
  } = opts;

  const text = String(raw || '').trim().replace(/\s+/g, ' ');
  const usablePx = Math.max(1, Math.round(w * (1 - 2 * marginX)));

  for (let fz = fontMax; fz >= fontMin; fz -= 2) {
    const maxChars = Math.max(6, Math.floor(usablePx / (fz * charW)));
    const words = text.split(' ');
    const lines = [];
    let cur = '';

    for (const ww of words) {
      const next = cur ? cur + ' ' + ww : ww;
      if (next.length <= maxChars) cur = next;
      else { if (cur) lines.push(cur); cur = ww; }
    }
    if (cur) lines.push(cur);

    if (lines.length <= maxLines) {
      return {
        text: lines.join('\n'),
        fontsize: fz,
        lineSpacing: Math.round(fz * lineSpacingFactor),
        // bottom-anchored, inside safe area, accounting for text height
        yExpr: `h-${Math.round(h * marginBottom)}-text_h`
      };
    }
  }

  // Fallback: no good fit, use smallest size.
  return {
    text,
    fontsize: fontMin,
    lineSpacing: Math.round(fontMin * 0.25),
    yExpr: `h-${Math.round(h * marginBottom)}-text_h`
  };
}

function runFfmpeg(args, opts = {}) {
  return new Promise((resolve, reject) => {
    // Log full args JSON for diagnostics
    try { console.log('[ffmpeg] spawn args JSON:', JSON.stringify(["-y", ...args])); } catch {}
    
    // Determine timeout based on whether this is a video (longer timeout)
    const isVideo = args.some(arg => typeof arg === 'string' && (arg.includes('.mp4') || arg.includes('.mov') || arg.includes('.webm')));
    const timeoutMs = opts.timeout || (isVideo ? 300000 : 300000); // default 5 minutes for stability
    
    // Force loglevel so parsing errors always appear on stderr
    const p = spawn(ffmpegPath, ["-y", "-v", (process.env.FFMPEG_LOGLEVEL || 'error'), ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => stdout += d);
    p.stderr.on('data', d => stderr += d);
    
    // Add timeout to prevent hanging
    const timeout = setTimeout(() => {
      console.log(`[ffmpeg] Timeout after ${timeoutMs}ms, killing process`);
      p.kill('SIGKILL');
      reject(new Error('FFMPEG_TIMEOUT'));
    }, timeoutMs);
    
    p.on("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0) console.error('[ffmpeg] exit', { code, signal, stderr: String(stderr).slice(0,8000) });
      if (code === 0) resolve({ stdout, stderr }); else reject(new Error(`ffmpeg exited with code ${code} signal ${signal || ''}: ${stderr}`));
    });
    p.on('close', (code, signal) => { if (code !== 0) console.error('[ffmpeg] close', { code, signal, stderr: String(stderr).slice(0,8000) }); });
    
    p.on('error', err => {
      clearTimeout(timeout);
      try { console.error('[ffmpeg] error', { message: err?.message, stack: err?.stack }); } catch {}
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
  });
}

// ---- Generalized helpers ----
function clamp01(x){ const n = Number(x); if (!Number.isFinite(n)) return 0; return Math.max(0, Math.min(1, n)); }

function fitQuoteToBox({ text, boxWidthPx, baseFontSize = 72 }) {
  const raw = String(text || '').trim().replace(/\s+/g, ' ');
  let fz = baseFontSize;
  const len = raw.length;
  if (len > 140) fz = Math.round(baseFontSize * 0.55);
  else if (len > 110) fz = Math.round(baseFontSize * 0.66);
  else if (len > 90) fz = Math.round(baseFontSize * 0.78);
  else if (len > 70) fz = Math.round(baseFontSize * 0.89);
  const approxCharW = fz * 0.55;
  const maxChars = Math.max(12, Math.floor(boxWidthPx / approxCharW));
  const words = raw.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (next.length <= maxChars) line = next; else { if (line) lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  const lineSpacing = Math.round(fz * 0.25);
  // Guard: ensure no line exceeds ~85% of width at current fontsize
  try {
    const safePx = 0.85 * Math.max(1, Number(boxWidthPx) || 1080);
    const pxPerChar = 0.55 * fz;
    const maxCharsLen = Math.max(0, ...lines.map(l => l.length));
    if ((maxCharsLen * pxPerChar) > safePx) {
      const adj = Math.floor(fz * safePx / Math.max(1, maxCharsLen * pxPerChar));
      fz = Math.max(16, adj);
    }
  } catch {}
  return { text: lines.join('\n'), fontsize: fz, lineSpacing };
}

function buildVideoChain({ width, height, videoVignette, drawLayers, captionImage }){
  const W = Math.max(4, Number(width)||1080);
  const H = Math.max(4, Number(height)||1920);
  // Fill portrait frame without letterboxing: scale to cover then crop
  const scale = `scale='if(gt(a,${W}/${H}),-2,${W})':'if(gt(a,${W}/${H}),${H},-2)'`;
  const crop = `crop=${W}:${H}`;
  const core = [ scale, crop, (videoVignette ? 'vignette=PI/4:0.5' : null), 'format=rgba' ].filter(Boolean);
  
  // If using PNG overlay for captions, create intermediate label and overlay
  if (CAPTION_OVERLAY && captionImage) {
    const baseChain = makeChain('0:v', [ joinF(core), ...drawLayers ].filter(Boolean), 'v0');
    const overlayChain = `[v0][1:v]overlay=x=${captionImage.xPx}:y=${captionImage.yPx}:eof_action=pass:format=auto,format=yuv420p[vout]`;
    return `${baseChain};${overlayChain}`;
  } else {
    // Legacy drawtext approach
    const vchain = makeChain('0:v', [ joinF(core), ...drawLayers, 'format=yuv420p' ].filter(Boolean), 'vout');
    return vchain;
  }
}

function buildAudioChain({ outSec, keepVideoAudio, haveBgAudio, ttsPath, leadInMs, tailSec, bgVol }){
  let aChain = '';
  if (ttsPath && keepVideoAudio && haveBgAudio) {
    const bg = makeChain('0:a', [
      `adelay=${leadInMs}|${leadInMs}`,
      `volume=${bgVol.toFixed(2)}`,
      'aresample=48000',
      'aformat=sample_fmts=fltp:channel_layouts=stereo'
    ], 'bg');
    const tts1 = makeChain('1:a', [
      `adelay=${leadInMs}|${leadInMs}`,
      'aresample=48000',
      'pan=stereo|c0=c0|c1=c0',
      'aformat=sample_fmts=fltp:channel_layouts=stereo',
      'asetpts=PTS-STARTPTS'
    ], 'tts1');
    const mix = `[bg][tts1]amix=inputs=2:duration=longest:dropout_transition=0 [aout]`;
    aChain = [bg, tts1, mix].join(';');
  } else if (ttsPath) {
    const tts1 = makeChain('1:a', [
      `adelay=${leadInMs}|${leadInMs}`,
      'aresample=48000',
      'pan=stereo|c0=c0|c1=c0',
      'aformat=sample_fmts=fltp:channel_layouts=stereo',
      'asetpts=PTS-STARTPTS'
    ], 'tts1');
    const sil = makeChain(null, [`anullsrc=r=48000:cl=stereo:d=${tailSec}`], 'sil');
    const concat = `[tts1][sil]concat=n=2:v=0:a=1 [aout]`;
    aChain = [tts1, sil, concat].join(';');
  } else if (keepVideoAudio && haveBgAudio) {
    aChain = makeChain('0:a', [
      `adelay=${leadInMs}|${leadInMs}`,
      `volume=${bgVol.toFixed(2)}`,
      'aresample=48000',
      'aformat=sample_fmts=fltp:channel_layouts=stereo'
    ], 'aout');
  } else {
    aChain = makeChain(null, [`anullsrc=r=48000:cl=stereo:d=${Math.max(0.8, outSec || 0.8)}`], 'aout');
  }
  return aChain;
}

export async function renderVideoQuoteOverlay({
  videoPath, outPath,
  // output dims/time
  width = 1080, height = 1920, durationSec = 8, fps = 24,
  // content
  text, authorLine,
  captionText,
  caption,
  captionResolved,
  captionImage,
  // style bundle
  fontfile, fontcolor = 'white', fontsize = 72, lineSpacing = 12, shadowColor = 'black', shadowX = 2, shadowY = 2,
  box = 1, boxcolor = 'black@0.35', boxborderw = 24,
  watermark = true, watermarkText = 'Vaiform', watermarkFontSize = 30, watermarkPadding = 42,
  safeMargin, // px or percent (0..1) if < 1
  // audio
  ttsPath,
  keepVideoAudio = false,
  bgAudioVolume = 1.0,
  duckDuringTTS = false,
  duck = { threshold: -18, ratio: 8, attack: 40, release: 250 },
  ttsDelayMs,
  tailPadSec,
  voiceoverDelaySec,
  // visual polish
  videoStartSec = 0,
  videoVignette = false,
  haveBgAudio = true,
}) {
  // Default font fallback if caller does not provide one
  const DEFAULT_FONT = process.env.DRAWTEXT_FONTFILE || '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
  const effFont = String(fontfile || DEFAULT_FONT);
  const W = Math.max(4, Number(width)||1080);
  const H = Math.max(4, Number(height)||1920);
  const sm = (typeof safeMargin === 'number')
    ? (safeMargin <= 1 ? Math.round(Math.min(W,H) * clamp01(safeMargin)) : Math.round(safeMargin))
    : Math.round(Math.min(W,H) * 0.06);

  const fit = fitQuoteToBox({ text, boxWidthPx: W - sm*2, baseFontSize: fontsize || 72 });
  const effLineSpacing = Math.max(2, Number.isFinite(lineSpacing) ? lineSpacing : fit.lineSpacing);
  try {
    const raw = String(text ?? '').trim();
    console.log('[fit]', JSON.stringify({ raw, fitted: fit.text, fontsize: fit.fontsize, lineSpacing: effLineSpacing }, null, 2));
  } catch {}

  // Write quote/author text to temp textfiles for robust multiline handling
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'vaiform-txt-'));
  const quoteTxtPath = path.join(tmpBase, 'quote.txt');
  const authorTxtPath = path.join(tmpBase, 'author.txt');
  let drawMain = '';
  try {
    const rawMain = String(text ?? '').trim();
    if (rawMain.length >= 2) {
      fs.writeFileSync(quoteTxtPath, String(fit.text), { encoding: 'utf8' });
      const stat = fs.statSync(quoteTxtPath);
      console.log('[drawtext][quotefile]', quoteTxtPath, 'bytes=', stat.size);
      if (stat.size > 0) {
        drawMain = `drawtext=${[
          `textfile='${quoteTxtPath.replace(/\\/g,'/').replace(/^([A-Za-z]):\//, "$1\\:/")}'`,
          `x=(w-text_w)/2`,
          `y=(h-text_h)/2`,
          `fontsize=${fit.fontsize}`,
          `fontcolor=${fontcolor}`,
          `shadowcolor=${shadowColor}`,`shadowx=${shadowX}`,`shadowy=${shadowY}`,
          `borderw=2`,`bordercolor=black@0.85`,
          `line_spacing=${effLineSpacing}`,
          `box=0`
        ].filter(Boolean).join(':')}`;
      }
    }
  } catch {}

  // drawMain is prepared above only when there is actual text content
  const drawAuthor = (authorLine && String(authorLine).trim()) ? (() => {
    try { fs.writeFileSync(authorTxtPath, String(authorLine).trim(), { encoding: 'utf8' }); console.log('[drawtext][authorfile]', authorTxtPath, 'bytes=', fs.statSync(authorTxtPath).size); } catch {}
    return `drawtext=${[
      `textfile='${authorTxtPath.replace(/\\/g,'/').replace(/^([A-Za-z]):\//, "$1\\:/")}'`,
      'x=(w-text_w)/2', `y=(h+text_h)/2+${Math.round(sm*0.8)}`,
      `fontsize=${Math.max(28, Math.round(fit.fontsize * 0.5))}`,
      `fontcolor=${fontcolor}`,
      `shadowcolor=${shadowColor}`,`shadowx=${shadowX}`,`shadowy=${shadowY}`,
      'box=0','borderw=0'
    ].filter(Boolean).join(':')}`;
  })() : '';
  const drawWatermark = watermark ? `drawtext=${[
    `fontfile='${effFont.replace(/\\/g,'/').replace(/^([A-Za-z]):\//, "$1\\:/")}'`,
    `text='${escapeForDrawtext(watermarkText || 'Vaiform')}'`,
    `x=w-tw-${watermarkPadding}`, `y=h-th-${watermarkPadding}`,
    `fontsize=${watermarkFontSize}`, 'fontcolor=white',
    'shadowcolor=black','shadowx=2','shadowy=2','borderw=2','bordercolor=black@0.85','box=0'
  ].filter(Boolean).join(':')}` : '';

  // Optional caption (bottom, safe area, wrapped)
  let drawCaption = '';
  
  // Skip drawtext caption rendering when using PNG overlay
  if (CAPTION_OVERLAY && captionImage) {
    console.log('[ffmpeg] Using PNG overlay for captions, skipping drawtext');
    drawCaption = '';
  } else if (caption && String(caption.text || '').trim()) {
    // Inputs
    const capTextRaw = String(caption.text || '').trim();
    const fittedFromPreview = (caption.fittedText && String(caption.fittedText).trim()) ? String(caption.fittedText).trim() : null;

    function scaleFontPx(fontSizePx = 32, previewH = 640) {
      const base = Math.max(1, Number(previewH) || 640);
      const px = Math.round((Number(fontSizePx) || 32) * (H / base));
      return Math.max(24, Math.min(140, px));
    }
    const oldFontPx = scaleFontPx(caption.fontSizePx, caption.previewHeightPx);

    // font file (bold vs regular) - match preview weight detection exactly
    const fontFileRegular = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
    const fontFileBold    = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
    const wantBold =
      String(caption.fontWeight || '').toLowerCase() === 'bold' ||
      Number(caption.fontWeight) >= 600 ||
      /bold/i.test(String(caption.fontFamily || '')) ||
      String(caption.weight || '').toLowerCase() === 'bold' ||  // Add support for weight field
      Number(caption.weight) >= 600;
    const originalFontFile = wantBold ? fontFileBold : fontFileRegular;

    // opacity + line spacing - match preview exactly (size * 1.2 - size = size * 0.2)
    const op = Math.max(0, Math.min(1, Number(caption.opacity ?? 0.8)));
    const lsRaw = Math.round((Number(caption.fontSizePx) || 32) * 0.20);
    const originalLineSp = Math.max(0, Math.round(lsRaw * (oldFontPx / Math.max(1, Number(caption.fontSizePx) || 32))));

    // Preview is authoritative - normalize resolved values up front
    const previewResolved = captionResolved || null;
    
    // helpers (inline, no imports)
    const clamp01 = v => Math.min(1, Math.max(0, Number(v)));
    const num = (v, d) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    };
    
    // fallbacks keep current behavior when previewResolved is missing
    const finalFontPx = num(previewResolved?.fontPx, oldFontPx);
    const oldLineSpacing = num(previewResolved?.lineSpacing, originalLineSp);
    const lineSp      = oldLineSpacing;               // ✅ alias used by existing template
    const oldTextAlpha   = clamp01(previewResolved?.textAlpha ?? 0.80);
    const oldStrokeW     = num(previewResolved?.strokeW, 3);
    const strokeAlpha = clamp01(previewResolved?.strokeAlpha ?? 0.85);
    const shadowAlpha = clamp01(previewResolved?.shadowAlpha ?? 0.55);
    const oldShadowX     = num(previewResolved?.shadowX, 0);
    const oldShadowY     = num(previewResolved?.shadowY, 2);
    const fontFile    = previewResolved?.fontFile
      ? `/usr/share/fonts/truetype/dejavu/${previewResolved.fontFile}`
      : (wantBold
          ? "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
          : "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf");
    
    // (optional but handy) one-time log so we can verify parity
    console.log('[preflight]', { fontPx: finalFontPx, lineSpacing: oldLineSpacing, textAlpha: oldTextAlpha, strokeW: oldStrokeW, strokeAlpha, shadowAlpha, shadowX: oldShadowX, shadowY: oldShadowY, fontFile });

    // text (prefer preview-fitted)
    let capText = fittedFromPreview || '';
    if (!capText) {
      // fallback heuristic (kept from previous logic)
      const contentW = Math.max(1, Math.round(W * 0.92));
      const charW = 0.60 * finalFontPx;
      const maxChars = Math.max(6, Math.floor(contentW / Math.max(1, charW)));
      const words = capTextRaw.split(/\s+/);
      const lines = [];
      let cur = '';
      for (const w2 of words) {
        const next = cur ? cur + ' ' + w2 : w2;
        if (next.length <= maxChars) cur = next; else { if (cur) lines.push(cur); cur = w2; }
      }
      if (cur) lines.push(cur);
      capText = lines.join('\n');
    }

    // This section is now handled by the pure painter approach above

    // per-line drawtext (centered x) — raw expression in single quotes; avoid escaping commas here
    const xFinal = `'max(20\\,min(w-20-text_w\\,(w*0.5)-text_w/2))'`;
    const wantBox = !!(caption.box && (caption.box.enabled || caption.wantBox));
    const boxAlpha = Math.max(0, Math.min(1, Number(caption.box?.alpha ?? caption.boxAlpha ?? 0)));
    
    // ---- Pure painter approach: use captionResolved verbatim when available ----
    let usingResolved = !!(captionResolved && captionResolved.fontPx && Array.isArray(captionResolved.splitLines) && captionResolved.splitLines.length > 0);
    
    let fontPx, lineSpacing, strokeW, shadowX, shadowY, textAlpha, baseY, lines, n, _lineSp;
    
    // Safety check: if we have captionResolved but no valid splitLines, fall back
    if (captionResolved && captionResolved.fontPx && (!Array.isArray(captionResolved.splitLines) || captionResolved.splitLines.length === 0)) {
      console.log('[render] captionResolved present but splitLines missing/empty; falling back to server layout');
      usingResolved = false;
    }
    
    if (usingResolved) {
      // Frontend computed everything - use values verbatim, no scaling, no re-wrap
      fontPx = Number(captionResolved.fontPx);
      lineSpacing = Number(captionResolved.lineSpacing || Math.round(fontPx * 0.25));
      strokeW = Number(captionResolved.strokeW || STROKE_W);
      shadowX = Number(captionResolved.shadowX || 0);
      shadowY = Number(captionResolved.shadowY || 2);
      textAlpha = Number(captionResolved.textAlpha || 1.0);
      const splitLines = captionResolved.splitLines || [];
      
      console.log(`[render] usingResolved=true fontPx=${fontPx} lineSpacing=${lineSpacing} strokeW=${strokeW} lines=${splitLines.length}`);
      
      // Use frontend's exact line breaks and positioning
      lines = splitLines;
      n = Math.max(1, lines.length);
      
      // Compute Y position from preview anchor (no scaling)
      const yPct = Number(captionResolved.yPct || caption?.pos?.yPct || 12);
      baseY = Math.round(H * yPct / 100);
      
    } else {
      // Fallback: old behavior for backward compatibility
      console.log('[render] usingResolved=false, falling back to legacy layout');
      
      // Y origin in pixels from top, from preview yPct (default 12%)
      const _calcTopY = (yPct) => {
        const pct = Number.isFinite(Number(yPct)) ? Number(yPct) : 12;
        return Math.max(20, Math.round(1920 * pct / 100));
      };

      fontPx = Number(caption.fontSizePx ?? 48);
      lineSpacing = Math.round(fontPx * 0.25);
      strokeW = STROKE_W;
      shadowX = 0;
      shadowY = 2;
      textAlpha = Number(caption?.opacity ?? 0.8);
      baseY = _calcTopY(caption?.pos?.yPct);
      
      // Re-wrap text (legacy behavior) - get text from caption or captionText
      const capTextRaw = String(caption.text || captionText || '').trim();
      if (capTextRaw) {
        const contentW = Math.max(1, Math.round(W * 0.92));
        const charW = 0.60 * fontPx;
        const maxChars = Math.max(6, Math.floor(contentW / Math.max(1, charW)));
        const words = capTextRaw.split(/\s+/);
        lines = [];
        let cur = '';
        for (const w2 of words) {
          const next = cur ? cur + ' ' + w2 : w2;
          if (next.length <= maxChars) cur = next; else { if (cur) lines.push(cur); cur = w2; }
        }
        if (cur) lines.push(cur);
      } else {
        lines = [];
      }
      
      n = Math.max(1, lines.length);
      console.log(`[render] legacy layout: fontPx=${fontPx} lineSpacing=${lineSpacing} lines=${lines.length} text="${capTextRaw}"`);
    }
    
    // Guard (avoid undefined var crash)
    _lineSp = Number.isFinite(lineSpacing) ? lineSpacing : 12;

    // keep existing font path (must match ffmpeg logs)
    const CAPTION_FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

    // Final preflight log (variables are now in scope from either branch)
    console.log('[preflight]', { fontPx, lineSpacing, strokeW, shadowX, shadowY, textAlpha, usingResolved });

    const capDraws = [];
    
    // Safety: if no valid lines, don't create any drawtext commands
    if (!lines || lines.length === 0 || lines.every(line => !line.trim())) {
      console.log('[render] no valid caption lines to draw');
      drawCaption = '';
    } else {
      // For each caption line, push THREE layers:
      // 1) softening shadow pass A
      // 2) softening shadow pass B  
      // 3) main white text + scalable stroke
      for (let i = 0; i < n; i++) {
      const lineY = Math.round(baseY + i * (fontPx + _lineSp));
      const line = lines[i] || '';
      
      // Skip empty lines to avoid drawtext=text=''
      if (!line.trim()) continue;
      
      const xExpr = xFinal;
      const yExpr = `'max(20\\,min(h-20-${fontPx}\\,${lineY}))'`;

      // pass A — subtle blur-ish base (no stroke)
      capDraws.push(
        `drawtext=text='${escapeForDrawtext(line)}'` +
        `:fontfile='${CAPTION_FONT_BOLD}'` +
        `:x='${xExpr}'` +
        `:y='${yExpr}'` +
        `:fontsize=${fontPx}` +
        `:line_spacing=${_lineSp}` +
        `:fontcolor=black@${(usingResolved ? (captionResolved?.shadowAlpha ?? 0.35) : 0.35).toFixed(2)}:borderw=0:shadowx=${shadowX}:shadowy=${shadowY}` +
        `:fix_bounds=1:text_shaping=1:box=0`
      );

      // pass B — second soften pass (no stroke)
      capDraws.push(
        `drawtext=text='${escapeForDrawtext(line)}'` +
        `:fontfile='${CAPTION_FONT_BOLD}'` +
        `:x='${xExpr}'` +
        `:y='${yExpr}'` +
        `:fontsize=${fontPx}` +
        `:line_spacing=${_lineSp}` +
        `:fontcolor=black@0.25:borderw=0:shadowx=${shadowX + 1}:shadowy=${shadowY + 1}` +
        `:fix_bounds=1:text_shaping=1:box=0`
      );

      // pass C — main text last (so stroke isn't dimmed)
      capDraws.push(
        `drawtext=text='${escapeForDrawtext(line)}'` +
        `:fontfile='${CAPTION_FONT_BOLD}'` +
        `:x='${xExpr}'` +
        `:y='${yExpr}'` +
        `:fontsize=${fontPx}` +
        `:line_spacing=${_lineSp}` +
        `:fontcolor=white@${textAlpha.toFixed(2)}` +
        `:borderw=${strokeW}:bordercolor=black@${(usingResolved ? (captionResolved?.strokeAlpha ?? 0.85) : 0.85).toFixed(2)}` +
        `:shadowx=0:shadowy=0` +
        `:fix_bounds=1:text_shaping=1:box=0`
      );
      }

      drawCaption = capDraws.join(',');
    }
  } else if (captionText && String(captionText).trim()) {
    // Back-compat: simple bottom caption with safe wrapping
    const CANVAS_W = W;
    const CANVAS_H = H;
    const cap = wrapCaption(captionText, CANVAS_W, CANVAS_H, { maxLines: 2, fontMax: 64, fontMin: 28 });
    drawCaption = `drawtext=${[
      `text='${escapeForDrawtext(cap.text)}'`,
      `fontfile='${effFont.replace(/\\/g,'/').replace(/^([A-Za-z]):\//, "$1\\:/")}'`,
      `x=(w-text_w)/2`,
      `y=${cap.yExpr}`,
      `fontsize=${cap.fontsize}`,
      `fontcolor=white`,
      `line_spacing=${cap.lineSpacing}`,
      `borderw=2:bordercolor=black@0.85`,
      `shadowcolor=black:shadowx=2:shadowy=2`,
      `box=0`
    ].filter(Boolean).join(':')}`;
  }
  try { console.log('[ffmpeg] drawMain', drawMain); } catch {}
  try { if (drawAuthor) console.log('[ffmpeg] drawAuthor', drawAuthor); } catch {}
  try { if (drawWatermark) console.log('[ffmpeg] drawWatermark', drawWatermark); } catch {}
  try { if (drawCaption) console.log('[ffmpeg] drawCaption', drawCaption); } catch {}

  // Debug: Log all draw layers before building the video chain
  console.log('[ffmpeg] DEBUG - drawMain:', drawMain);
  console.log('[ffmpeg] DEBUG - drawAuthor:', drawAuthor);
  console.log('[ffmpeg] DEBUG - drawWatermark:', drawWatermark);
  console.log('[ffmpeg] DEBUG - drawCaption:', drawCaption);
  console.log('[ffmpeg] DEBUG - text param:', text);
  console.log('[ffmpeg] DEBUG - captionText param:', captionText);

  const vchain = buildVideoChain({ 
    width: W, 
    height: H, 
    videoVignette, 
    drawLayers: [drawMain, drawAuthor, drawWatermark, drawCaption].filter(Boolean),
    captionImage: CAPTION_OVERLAY ? captionImage : null
  });
  // If includeBottomCaption flag is passed via captionStyle, honor it

  // ---- Audio chain builders ----
  // Compute mix length safety
  let outSec = Number(durationSec);
  if (!Number.isFinite(outSec) || outSec <= 0) {
    let videoMs = null;
    let ttsMs = null;
    try { if (videoPath) videoMs = await getDurationMsFromMedia(videoPath); } catch {}
    try { if (ttsPath) ttsMs = await getDurationMsFromMedia(ttsPath); } catch {}
    const maxMs = Math.max(videoMs || 0, ttsMs || 0);
    outSec = (maxMs > 0) ? (maxMs/1000 + 0.3) : 8;
  }
  try { console.log('[mix] outSec', outSec, { keepVideoAudio, hasTTS: !!ttsPath }); } catch {}
  const envDelay = Number(process.env.TTS_DELAY_MS ?? 1000);
  const envTailMs = Number(process.env.TTS_TAIL_MS ?? 800);
  const leadInMs = Math.round(
    (Number.isFinite(Number(voiceoverDelaySec)) ? Number(voiceoverDelaySec) : (Number.isFinite(Number(ttsDelayMs)) ? Number(ttsDelayMs)/1000 : envDelay/1000)) * 1000
  );
  const tailSec = Math.max(0, Number.isFinite(Number(tailPadSec)) ? Number(tailPadSec) : (envTailMs/1000));
  const bgVol = Math.min(1, Math.max(0, Number.isFinite(Number(bgAudioVolume)) ? Number(bgAudioVolume) : 0.35));

  const aChain = buildAudioChain({ outSec, keepVideoAudio, haveBgAudio, ttsPath, leadInMs, tailSec, bgVol });

  // Assemble and log RAW vs FINAL filter_complex
  const rawFilter = [vchain, aChain].filter(Boolean).join(';');
  const finalFilter = (process.env.BYPASS_SANITIZE === '1') ? rawFilter : sanitizeFilter(rawFilter);
  console.log('[ffmpeg] RAW   -filter_complex:', rawFilter);
  console.log('[ffmpeg] FINAL -filter_complex:', finalFilter);
  try {
    const scaleDesc = `scale='if(gt(a,${W}/${H}),-2,${W})':'if(gt(a,${W}/${H}),${H},-2)'`;
    const cropDesc = `crop=${W}:${H}`;
    console.log('[ffmpeg] geometry', { scale: scaleDesc, crop: cropDesc });
  } catch {}
  if (finalFilter.includes('],') || finalFilter.includes(',[')) {
    console.warn('[ffmpeg][warn] commas around labels detected');
  }
  if (finalFilter.includes(';;')) {
    const err = new Error('FILTER_SANITIZE_FAILED');
    err.filter = finalFilter;
    throw err;
  }
  if (!finalFilter.includes('[vout]') || !finalFilter.includes('[aout]')) {
    console.warn('[ffmpeg][warn] expected [vout] and [aout] labels present?');
  }

  // Accurate seek: place -ss after input to avoid black frames on sparse keyframes
  const args = [
    '-y',
    '-i', videoPath,
    ...(CAPTION_OVERLAY && captionImage ? ['-i', captionImage.pngPath] : []),
    ...(ttsPath ? ['-i', ttsPath] : []),
    '-ss', '0.5',
    '-filter_complex', finalFilter,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast',
    '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart',
    '-r', String(fps),
    '-t', String(outSec),
    outPath,
  ];
  if (keepVideoAudio && !ttsPath) {
    args.splice( args.indexOf('-c:v'), 0, '-shortest');
  }
  try {
    await runFfmpeg(args);
  } catch (e) {
    const err = new Error('RENDER_FAILED');
    err.filter = finalFilter;
    err.cause = e;
    if (e && typeof e === 'object') {
      err.stderr = e.stderr || '';
      err.code = e.code;
    }
    try { console.error('[ffmpeg] compose failed', { code: e?.code, message: e?.message, stderr: String(e?.stderr||'').slice(0,8000) }); } catch {}
    throw err;
  }
  return { outPath, durationSec: outSec };
}

export async function exportPoster({ videoPath, outPngPath, width = 1080, height = 1920, atSec = 0.2 }){
  // Ensure directory exists
  await fsp.mkdir(path.dirname(outPngPath), { recursive: true });

  const vf = [
    `scale=${width}:-2:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`
  ].join(',');

  const args = [
    '-y',
    '-ss', String(atSec),
    '-i', videoPath,
    '-frames:v', '1',
    '-vf', vf,
    '-f', 'image2',
    '-update', '1',
    outPngPath,
  ];

  await new Promise((resolve, reject) => {
    let stderr = '';
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('exit', (code) => {
      if (code === 0) {
        console.log('[poster] wrote', outPngPath);
        resolve();
      } else {
        console.error('[poster] command failed:', ffmpegPath, args.join(' '));
        if (stderr) console.error('[poster] stderr:', stderr);
        const err = new Error('POSTER_RENDER_FAILED');
        err.stderr = stderr;
        err.args = args;
        reject(err);
      }
    });
  });
}

export async function exportAudioMp3({ videoPath, ttsPath, outPath, durationSec = 8, voiceoverDelaySec, ttsDelayMs, keepVideoAudio = false, haveBgAudio = true, bgAudioVolume = 0.35, tailPadSec }){
  const outSec = Math.max(0.1, Number(durationSec) || 8);
  const envDelay = Number(process.env.TTS_DELAY_MS ?? 1000);
  const envTailMs = Number(process.env.TTS_TAIL_MS ?? 800);
  const leadInMs = Math.round(
    (Number.isFinite(Number(voiceoverDelaySec)) ? Number(voiceoverDelaySec) : (Number.isFinite(Number(ttsDelayMs)) ? Number(ttsDelayMs)/1000 : envDelay/1000)) * 1000
  );
  const tailSec = Math.max(0, Number.isFinite(Number(tailPadSec)) ? Number(tailPadSec) : (envTailMs/1000));
  const bgVol = Math.min(1, Math.max(0, Number.isFinite(Number(bgAudioVolume)) ? Number(bgAudioVolume) : 0.35));
  const aChain = buildAudioChain({ outSec, keepVideoAudio, haveBgAudio, ttsPath, leadInMs, tailSec, bgVol });
  const rawFilter = [aChain].join(';');
  const finalFilter = (process.env.BYPASS_SANITIZE === '1') ? rawFilter : sanitizeFilter(rawFilter);
  console.log('[ffmpeg] RAW   -filter_complex:', rawFilter);
  console.log('[ffmpeg] FINAL -filter_complex:', finalFilter);
  const args = [
    ...(videoPath ? ['-i', videoPath] : ['-f','lavfi','-i','anullsrc=r=48000:cl=stereo:d=' + String(outSec)]),
    ...(ttsPath ? ['-i', ttsPath] : []),
    '-filter_complex', finalFilter,
    '-map', '[aout]',
    '-c:a', 'libmp3lame', '-b:a', '128k',
    '-t', String(outSec),
    outPath,
  ];
  await runFfmpeg(args);
}

export async function renderAllFormats(renderSpec) {
  const id = String(renderSpec?.id || `rnd-${Date.now().toString(36)}`);
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${id}-`));
  const base = path.join(tmpRoot, id);

  const formats = [
    { key: '9x16',   width: 1080, height: 1920 },
    { key: '1x1',    width: 1080, height: 1080 },
    { key: '16x9',   width: 1920, height: 1080 },
  ];

  const outputs = {};
  const common = renderSpec || {};
  const videoPath = common.videoPath;
  const imagePath = common.imagePath;
  const ttsPath = common.ttsPath;
  const durationSec = common?.output?.durationSec ?? common.durationSec ?? 8;
  const tailPadSec = common?.output?.tailPadSec ?? common.tailPadSec;

  for (const f of formats) {
    const outPath = `${base}_${f.key}.mp4`;
    if (videoPath) {
      await renderVideoQuoteOverlay({
        ...common,
        videoPath,
        ttsPath,
        outPath,
        width: f.width,
        height: f.height,
        durationSec,
        tailPadSec,
      });
    } else if (imagePath) {
      await renderImageQuoteVideo({
        outPath,
        imagePath,
        width: f.width,
        height: f.height,
        durationSec,
        text: common.text,
        fontfile: common.fontfile,
        fontcolor: common.fontcolor,
        fontsize: common.fontsize,
        lineSpacing: common.lineSpacing,
        shadowColor: common.shadowColor,
        shadowX: common.shadowX,
        shadowY: common.shadowY,
        box: common.box,
        boxcolor: common.boxcolor,
        boxborderw: common.boxborderw,
        authorLine: common.authorLine,
        authorFontsize: common.authorFontsize,
        kenBurns: common.kenBurns,
        progressBar: false,
        watermark: common.watermark,
        watermarkText: common.watermarkText,
        watermarkFontSize: common.watermarkFontSize,
        watermarkPadding: common.watermarkPadding,
      });
    } else {
      throw new Error('RENDER_SPEC_REQUIRES_videoPath_or_imagePath');
    }
    outputs[f.key] = outPath;
  }

  // Poster from vertical variant
  const posterPath = `${base}_poster_9x16.png`;
  try {
    await exportPoster({ videoPath: outputs['9x16'], outPngPath: posterPath, atSec: 0.2, width: 1080, height: 1920 });
    outputs.poster = posterPath;
  } catch (e) {
    console.warn('[ffmpeg] poster export failed:', e?.message || e);
  }

  // Audio-only mp3 from audio graph
  const mp3Path = `${base}.mp3`;
  try {
    await exportAudioMp3({ videoPath: videoPath || null, ttsPath, outPath: mp3Path, durationSec, voiceoverDelaySec: common.voiceoverDelaySec, ttsDelayMs: common.ttsDelayMs, keepVideoAudio: !!common.keepVideoAudio, haveBgAudio: !!common.haveBgAudio, bgAudioVolume: common.bgAudioVolume, tailPadSec });
    outputs.audio = mp3Path;
  } catch (e) {
    console.warn('[ffmpeg] audio export failed:', e?.message || e);
  }

  return { id, tmpRoot, files: outputs };
}

export async function exportSocialImage({
  videoPath,
  imagePath,
  outPath,
  width = 1080,
  height = 1350,
  text,
  authorLine,
  fontfile,
  fontcolor = 'white',
  fontsize = 72,
  lineSpacing = 12,
  shadowColor = 'black',
  shadowX = 2,
  shadowY = 2,
  box = 1,
  boxcolor = 'black@0.35',
  boxborderw = 24,
  watermark = true,
  watermarkText = 'Vaiform',
  watermarkFontSize = 30,
  watermarkPadding = 42,
  safeMargin,
  ssSec = 1,
}) {
  if (!outPath) throw new Error('outPath required');
  if (!videoPath && !imagePath) throw new Error('IMAGE_OR_VIDEO_REQUIRED');
  const W = Math.max(4, Number(width)||1080);
  const H = Math.max(4, Number(height)||1350);
  const sm = (typeof safeMargin === 'number')
    ? (safeMargin <= 1 ? Math.round(Math.min(W,H) * clamp01(safeMargin)) : Math.round(safeMargin))
    : Math.round(Math.min(W,H) * 0.06);
  const fit = fitQuoteToBox({ text, boxWidthPx: W - sm*2, baseFontSize: fontsize || 72 });
  const quoteTxt = escText(fit.text);
  const effLineSpacing = Math.max(2, Number.isFinite(lineSpacing) ? lineSpacing : fit.lineSpacing);

  const drawMain = `drawtext=${[
    `text='${quoteTxt}'`,
    fontfile ? `fontfile='${fontfile}'` : null,
    `x=(w-text_w)/2`,
    `y=(h-text_h)/2`,
    `fontsize=${fit.fontsize}`,
    `fontcolor=${fontcolor}`,
    `shadowcolor=${shadowColor}`,`shadowx=${shadowX}`,`shadowy=${shadowY}`,
    `box=${box}`,`boxcolor=${boxcolor}`,`boxborderw=${boxborderw}`,
    `line_spacing=${effLineSpacing}`,'borderw=0'
  ].filter(Boolean).join(':')}`;
  
  // Debug: Log the filter construction
  console.log('[ffmpeg] DEBUG - quoteTxt:', quoteTxt);
  console.log('[ffmpeg] DEBUG - drawMain:', drawMain);
  const drawAuthor = (authorLine && String(authorLine).trim()) ? `drawtext=${[
    fontfile ? `fontfile='${fontfile}'` : null,
    `text='${escText(String(authorLine).trim())}'`,
    'x=(w-text_w)/2', `y=(h+th)/2+${Math.round(sm*0.8)}`,
    `fontsize=${Math.max(28, Math.round(fit.fontsize * 0.5))}`,
    `fontcolor=${fontcolor}`,
    `shadowcolor=${shadowColor}`,`shadowx=${shadowX}`,`shadowy=${shadowY}`,
    'box=0','borderw=0'
  ].filter(Boolean).join(':')}` : '';
  const drawWatermark = watermark ? `drawtext=${[
    fontfile ? `fontfile='${fontfile}'` : null,
    `text='${escText(watermarkText || 'Vaiform')}'`,
    `x=w-tw-${watermarkPadding}`, `y=h-th-${watermarkPadding}`,
    `fontsize=${watermarkFontSize}`, 'fontcolor=white',
    'shadowcolor=black','shadowx=2','shadowy=2','box=1','boxcolor=black@0.25','boxborderw=12','borderw=0'
  ].filter(Boolean).join(':')}` : '';

  const scale = `scale='min(iw*${H}/ih\,${W})':'min(ih*${W}/iw\,${H})':force_original_aspect_ratio=decrease`;
  const pad = `pad=${W}:${H}:ceil((${W}-iw)/2):ceil((${H}-ih)/2)`;
  const core = [ scale, pad, 'format=rgba', drawMain, drawAuthor, drawWatermark, 'format=yuv420p' ].filter(Boolean);
  const chain = makeChain('0:v', [ joinF(core) ], 'vout');
  const finalFilter = sanitizeFilter(chain);

  const args = [
    '-y',
    ...(videoPath ? ['-ss', String(ssSec), '-i', videoPath] : ['-loop','1','-t','1','-i', imagePath]),
    '-frames:v','1',
    '-filter_complex', finalFilter,
    '-map','[vout]',
    '-f','image2', outPath,
  ];
  await runFfmpeg(args);
}

export default { renderVideoQuoteOverlay, renderAllFormats, exportPoster, exportAudioMp3, exportSocialImage };


