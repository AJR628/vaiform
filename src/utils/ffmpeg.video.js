import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { renderImageQuoteVideo } from "./ffmpeg.js";
import { getDurationMsFromMedia } from "./media.duration.js";

// text/path helpers
const esc = s => String(s).replace(/\\/g,'\\\\').replace(/:/g,'\\:').replace(/,/g,'\\,').replace(/;/g,'\\;').replace(/\[/g,'\\[').replace(/\]/g,'\\]').replace(/'/g,"\\'");
function escText(s) {
  const result = String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n");
  console.log('[ffmpeg] DEBUG - escText input:', s);
  console.log('[ffmpeg] DEBUG - escText output:', result);
  return result;
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
    
    const p = spawn(ffmpegPath, ["-y", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => stdout += d);
    p.stderr.on('data', d => stderr += d);
    
    // Add timeout to prevent hanging
    const timeout = setTimeout(() => {
      console.log(`[ffmpeg] Timeout after ${timeoutMs}ms, killing process`);
      p.kill('SIGKILL');
      reject(new Error('FFMPEG_TIMEOUT'));
    }, timeoutMs);
    
    p.on("exit", code => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      }
    });
    
    p.on('error', err => {
      clearTimeout(timeout);
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

function buildVideoChain({ width, height, videoVignette, drawLayers }){
  const W = Math.max(4, Number(width)||1080);
  const H = Math.max(4, Number(height)||1920);
  // Fill portrait frame without letterboxing: scale to cover then crop
  const scale = `scale='if(gt(a,${W}/${H}),-2,${W})':'if(gt(a,${W}/${H}),${H},-2)'`;
  const crop = `crop=${W}:${H}`;
  const core = [ scale, crop, (videoVignette ? 'vignette=PI/4:0.5' : null), 'format=yuv420p' ].filter(Boolean);
  const vchain = makeChain('0:v', [ joinF(core), ...drawLayers ].filter(Boolean), 'vout');
  return vchain;
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
    `text='${escText(watermarkText || 'Vaiform')}'`,
    `x=w-tw-${watermarkPadding}`, `y=h-th-${watermarkPadding}`,
    `fontsize=${watermarkFontSize}`, 'fontcolor=white',
    'shadowcolor=black','shadowx=2','shadowy=2','borderw=2','bordercolor=black@0.85','box=0'
  ].filter(Boolean).join(':')}` : '';

  // Optional caption (bottom, safe area, wrapped)
  let drawCaption = '';
  if (caption && String(caption.text || '').trim()) {
    // Honor precise caption layout from payload
    const capTextRaw = String(caption.text).trim();
    const RENDER_W = W;
    const RENDER_H = H;
    function scaleFontPx(fontSizePx = 32, previewH = 640) {
      const s = RENDER_H / Math.max(1, Number(previewH) || 640);
      const px = Math.round((Number(fontSizePx) || 32) * s);
      return Math.max(24, Math.min(140, px));
    }
    const fontPx = scaleFontPx(caption.fontSizePx, caption.previewHeightPx);
    // Derive a safe max text box width; allow wider when centered
    const maxWidthPx = Math.round(RENDER_W * 0.78); // tighter to avoid edge spill
    const charW = 0.66 * fontPx; // conservative avg glyph width to prevent joining
    const maxChars = Math.max(6, Math.floor(maxWidthPx / Math.max(1, charW)));
    const words = capTextRaw.split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w2 of words) {
      const next = cur ? cur + ' ' + w2 : w2;
      if (next.length <= maxChars) cur = next; else { if (cur) lines.push(cur); cur = w2; }
    }
    if (cur) lines.push(cur);
    const fitted = lines.join('\n');
    const lsRaw = Number.isFinite(Number(caption.lineSpacingPx))
      ? Math.max(0, Number(caption.lineSpacingPx))
      : Math.round((Number(caption.fontSizePx) || 32) * 0.26);
    const scaleFactor = (Number(caption.fontSizePx) ? (fontPx / Math.max(1, Number(caption.fontSizePx))) : 1);
    const lineSp = Math.max(0, Math.round(lsRaw * scaleFactor));
    const op = Math.max(0, Math.min(1, Number(caption.opacity ?? 0.8)));
    const xPct = Math.max(0, Math.min(100, Number((caption.position?.xPct ?? caption.pos?.xPct) ?? 50)));
    const yPct = Math.max(0, Math.min(100, Number((caption.position?.yPct ?? caption.pos?.yPct) ?? 88)));
    const align = (caption.align === 'left' || caption.align === 'right') ? caption.align : 'center';
    const xExprRaw = align === 'left' ? `(w*${(xPct/100).toFixed(4)})`
      : (align === 'right' ? `(w*${(xPct/100).toFixed(4)})-text_w` : `(w*${(xPct/100).toFixed(4)})-text_w/2`);
    const xClamp = `max(20,min(w-20-text_w,${xExprRaw}))`;
    const vAlign = (caption.vAlign === 'top' || caption.vAlign === 'bottom') ? caption.vAlign : 'center';
    const yBase = `(h*${(yPct/100).toFixed(4)})`;
    const yExprRaw = vAlign === 'top' ? yBase : (vAlign === 'bottom' ? `${yBase}-text_h` : `${yBase}-text_h/2`);
    const yClamp = `max(20,min(h-20-text_h,${yExprRaw}))`;
    const wantBox = !!(caption.box && caption.box.enabled) || !!caption.wantBox;
    const boxAlpha = Math.max(0, Math.min(1, Number((caption.box?.bgAlpha ?? caption.boxAlpha) ?? 0.0)));
    try { console.log('[ffmpeg] CAPTION(layout)', { fontPxRaw: caption.fontSizePx, fontPxScaled: fontPx, xPct, yPct, vAlign, align, op, lineSp, wantBox, boxAlpha, wrappedCols: maxChars }); } catch {}
    // Write caption file UTF-8 LF without trailing spaces
    const captionTxtPath = path.join(tmpBase, 'caption.txt');
    try {
      const normalized = String(fitted)
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(s => s.replace(/[ \t]+$/, ''))
        .join('\n');
      fs.writeFileSync(captionTxtPath, normalized, { encoding: 'utf8' });
      try { const st = fs.statSync(captionTxtPath); console.log('[drawtext][captionfile]', captionTxtPath, 'bytes=', st.size); } catch {}
    } catch {}
    const captionTxtEsc = captionTxtPath.replace(/\\/g,'/').replace(/^([A-Za-z]):\//, "$1\\:/");
    const fontEsc = effFont.replace(/\\/g,'/').replace(/^([A-Za-z]):\//, "$1\\:/");
    drawCaption = `drawtext=${[
      `textfile='${captionTxtEsc}'`,
      `fontfile='${fontEsc}'`,
      `x='${xClamp.replace(/'/g, "\\'")}'`,
      `y='${yClamp.replace(/'/g, "\\'")}'`,
      `fontsize=${fontPx}`,
      `fontcolor=white@${op.toFixed(2)}`,
      `line_spacing=${lineSp}`,
      `use_kerning=1`,
      `fix_bounds=1`,
      `borderw=2:bordercolor=black@0.85`,
      `shadowcolor=black:shadowx=2:shadowy=2`,
      `box=${wantBox?1:0}`,
      wantBox ? `boxcolor=black@${boxAlpha.toFixed(2)}` : null,
      `boxborderw=${wantBox?16:0}`
    ].filter(Boolean).join(':')}`;
  } else if (captionText && String(captionText).trim()) {
    // Back-compat: simple bottom caption with safe wrapping
    const CANVAS_W = W;
    const CANVAS_H = H;
    const cap = wrapCaption(captionText, CANVAS_W, CANVAS_H, { maxLines: 2, fontMax: 64, fontMin: 28 });
    drawCaption = `drawtext=${[
      `text='${escText(cap.text)}'`,
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

  const vchain = buildVideoChain({ width: W, height: H, videoVignette, drawLayers: [drawMain, drawAuthor, drawWatermark, drawCaption].filter(Boolean) });
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
  const core = [ scale, pad, 'format=yuv420p', drawMain, drawAuthor, drawWatermark ].filter(Boolean);
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


