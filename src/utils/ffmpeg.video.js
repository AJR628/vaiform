import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import pkg from "@napi-rs/canvas";
import { renderImageQuoteVideo } from "./ffmpeg.js";
import { getDurationMsFromMedia } from "./media.duration.js";
import { CAPTION_OVERLAY } from "../config/env.js";
import { hasLineSpacingOption } from "./ffmpeg.capabilities.js";
import { normalizeOverlayCaption, computeOverlayPlacement } from "../render/overlay.helpers.js";
import { fetchToTmp, cleanupTmp } from "./tmp.js";
import { resolveFontFile, assertFontExists, escapeFontPath } from "./font.registry.js";

const { createCanvas } = pkg;

// Helper function to save dataUrl to temporary file
export async function saveDataUrlToTmp(dataUrl, prefix = "caption") {
  const m = /^data:(.+?);base64,(.*)$/.exec(dataUrl || "");
  if (!m) throw new Error("BAD_DATA_URL");
  const [, mime, b64] = m;
  const buf = Buffer.from(b64, "base64");
  const ext = mime.includes("png") ? ".png" : ".bin";
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vaiform-"));
  const file = path.join(tmpDir, `${prefix}${ext}`);
  fs.writeFileSync(file, buf);
  return { file, mime };
}

// Helper function to write caption text to file (safe from escaping issues)
function writeCaptionTxt(text) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vaiform-"));
  const file = path.join(tmpDir, "caption.txt");
  fs.writeFileSync(file, text ?? "", { encoding: "utf8" });
  return file;
}

/**
 * Assert raster mode parity constraints - fail fast on any deviation
 */
function assertRasterParity(overlayCaption, captionPngPath, finalFilter) {
  if (!overlayCaption || overlayCaption.mode !== 'raster') return;
  
  console.log('[assertRasterParity] Validating raster mode SSOT...');
  
  const errors = [];
  
  // Required fields
  if (!overlayCaption.rasterUrl) errors.push('rasterUrl missing');
  if (!overlayCaption.rasterW || overlayCaption.rasterW <= 0) errors.push('invalid rasterW');
  if (!overlayCaption.rasterH || overlayCaption.rasterH <= 0) errors.push('invalid rasterH');
  if (overlayCaption.yPx_png == null || !Number.isFinite(overlayCaption.yPx_png)) errors.push('invalid yPx_png');
  if (!overlayCaption.rasterPadding) errors.push('rasterPadding missing (vertical shift risk)');
  if (!overlayCaption.frameW || !overlayCaption.frameH) errors.push('frameW/frameH missing');
  if (!overlayCaption.bgScaleExpr || !overlayCaption.bgCropExpr) errors.push('bgScaleExpr/bgCropExpr missing');
  if (!overlayCaption.rasterHash) errors.push('rasterHash missing (cannot verify PNG integrity)');
  if (!overlayCaption.previewFontString) errors.push('previewFontString missing');
  
  // PNG file must exist
  if (!captionPngPath || !fs.existsSync(captionPngPath)) {
    errors.push('PNG file missing at ' + captionPngPath);
  }
  
  // Forbidden fields (indicate wrong mode)
  if (overlayCaption.yPxFirstLine != null) {
    console.warn('[assertRasterParity] yPxFirstLine present (should use yPx_png only)');
  }
  if (overlayCaption.yPct != null) {
    console.warn('[assertRasterParity] yPct present (raster uses absolute yPx_png)');
  }
  
  // Filter must have ≤1 drawtext (watermark only)
  if (finalFilter) {
    const drawtextMatches = finalFilter.match(/drawtext=/g) || [];
    if (drawtextMatches.length > 1) {
      errors.push(`Multiple drawtext nodes (${drawtextMatches.length}) - expected 1 watermark only`);
    }
    
    // Forbidden: overlay scaling in raster mode
    if (finalFilter.includes('[1:v]scale')) {
      errors.push('[1:v]scale detected - overlay must NOT be scaled in raster mode (Design A)');
    }
  }
  
  if (errors.length > 0) {
    console.error('[assertRasterParity] FAILED:', errors);
    throw new Error('RASTER_PARITY violations: ' + errors.join('; '));
  }
  
  console.log('[assertRasterParity] ✅ All constraints validated');
}

// --- Caption render parity with preview ---
// DEPRECATED: These constants are superseded by resolveFontFile() in font.registry.js
// They remain for reference only. All render paths should use:
//   resolveFontFile(weightCss, fontStyle) → correct .ttf path
const CAPTION_FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const CAPTION_FONT_REG  = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

// Font resolution now handled by SSOT font.registry.js

// Match preview look: slightly higher outline + soft drop shadow
const CAPTION_ALPHA     = 0.80;   // white text opacity (preview uses ~80%)
const STROKE_ALPHA      = 0.85;   // dark outline opacity
const STROKE_W          = 3;      // outline width - matches preview styling
const SHADOW_ALPHA      = 0.55;   // drop shadow opacity
const SHADOW_X          = 0;      // no horizontal shift (keeps symmetry)
const SHADOW_Y          = 2;      // slight vertical softness
const BOX_BG_ALPHA      = 0.00;   // keep disabled unless user checks "Show box"

// text/path helpers
const esc = s => String(s).replace(/\\/g,'\\\\').replace(/:/g,'\\:').replace(/\[/g,'\\[').replace(/\]/g,'\\]').replace(/'/g,"\\'");
function escText(s) {
  // Escape characters that break drawtext text=... parsing
  return String(s)
    .replace(/\\/g, '\\\\')   // backslash first
    .replace(/'/g, "\\'")     // apostrophe
    .replace(/:/g, '\\:')     // option separator
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
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/%/g, '\\%')
    // quotes
    .replace(/'/g, "\\'");
    // ❌ REMOVED: .replace(/\r?\n/g, '\\n');  // This causes double-escaping
}

// Normalize color to hex format for FFmpeg (avoids comma escaping in rgb())
function normalizeColorForFFmpeg(color) {
  if (!color) return 'white';
  const c = String(color).trim();
  
  // Already hex format
  if (c.startsWith('#')) return c;
  
  // Parse rgb(R, G, B) or rgba(R, G, B, A)
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c);
  if (m) {
    const r = parseInt(m[1], 10);
    const g = parseInt(m[2], 10);
    const b = parseInt(m[3], 10);
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
  }
  
  // Named colors or other formats - pass through (ffmpeg supports named colors)
  return c;
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
        text: lines.join('\n'),  // Use actual newlines, escapeForDrawtext will handle escaping
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
  return { text: lines.join('\n'), fontsize: fz, lineSpacing };  // Use actual newlines, escapeForDrawtext will handle escaping
}

function buildVideoChain({ width, height, videoVignette, drawLayers, captionImage, usingCaptionPng, captionPngPath, rasterPlacement }){
  const W = Math.max(4, Number(width)||1080);
  const H = Math.max(4, Number(height)||1920);
  
  // If using PNG overlay for captions (SSOT v3 raster mode)
  if (usingCaptionPng && captionPngPath && fs.existsSync(captionPngPath)) {
    console.log(`[render] USING PNG OVERLAY from: ${captionPngPath}`);
    // Build filter graph: scale -> crop -> format -> [vmain], then overlay PNG
    // CRITICAL: Use persisted geometry from preview for exact parity
    let scale, crop;
    if (rasterPlacement?.bgScaleExpr && rasterPlacement?.bgCropExpr) {
      // Use EXACT expressions from preview
      scale = rasterPlacement.bgScaleExpr;
      crop = rasterPlacement.bgCropExpr;
      console.log('[buildVideoChain] Using preview geometry:', { scale, crop });
    } else {
      // Fallback (should not happen in strict raster mode)
      scale = `scale='if(gt(a,${W}/${H}),-2,${W})':'if(gt(a,${W}/${H}),${H},-2)'`;
      crop = `crop=${W}:${H}`;
      if (usingCaptionPng) {
        console.warn('[buildVideoChain] Missing bgScaleExpr/bgCropExpr in raster mode!');
      }
    }
    const core = [ scale, crop, (videoVignette ? 'vignette=PI/4:0.5' : null), 'format=rgba' ].filter(Boolean);
    const baseChain = makeChain('0:v', core, 'vmain');
    
    // 🔒 NO SCALING - use preview dimensions verbatim for perfect parity
    const pngPrep = `[1:v]format=rgba[ovr]`;
    
    console.log('[v3:parity] Using preview dimensions verbatim:', {
      rasterW: rasterPlacement?.rasterW,
      rasterH: rasterPlacement?.rasterH,
      yPx: rasterPlacement?.y,
      xExpr: rasterPlacement?.xExpr
    });
    
    // Overlay with format=auto to preserve alpha
    const xExpr = rasterPlacement?.xExpr || '(W-overlay_w)/2';
    const y = Math.round(rasterPlacement?.y ?? 0);
    const overlayExpr = `[vmain][ovr]overlay=${xExpr}:${y}:format=auto[vout]`;
    
    // CRITICAL: Log final overlay configuration
    console.log('[render:raster:FFMPEG]', {
      noScaling: true,
      actualRasterW: rasterPlacement?.rasterW,
      actualRasterH: rasterPlacement?.rasterH,
      xExpr,
      y
    });
    
    const filter = `${baseChain};${pngPrep};${overlayExpr}`;
    
    return filter;
  } else if (CAPTION_OVERLAY && captionImage) {
    // Legacy overlay format (keep for backward compatibility)
    // Verify the overlay file exists before using it
    const overlayPath = captionImage.pngPath || captionImage.localPath;
    if (overlayPath && fs.existsSync(overlayPath) && fs.statSync(overlayPath).size > 0) {
      console.log(`[render] USING LEGACY OVERLAY at x=${captionImage.xPx} y=${captionImage.yPx} w=${captionImage.wPx} h=${captionImage.hPx}`);
      const baseChain = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[v0]`;
      const overlayChain = `[v0][1:v]overlay=${captionImage.xPx}:${captionImage.yPx}:format=auto[vout]`;
      return `${baseChain};${overlayChain}`;
    } else {
      console.warn(`[render] Legacy overlay file not found or empty: ${overlayPath}, falling back to drawtext`);
      // Fall through to drawtext approach
    }
  } else {
    // Legacy drawtext approach
    const scale = `scale='if(gt(a,${W}/${H}),-2,${W})':'if(gt(a,${W}/${H}),${H},-2)'`;
    const crop = `crop=${W}:${H}`;
    const core = [ scale, crop, (videoVignette ? 'vignette=PI/4:0.5' : null), 'format=rgba' ].filter(Boolean);
    const vchain = makeChain('0:v', [ ...core, ...drawLayers, 'format=yuv420p' ].filter(Boolean), 'vout');
    return vchain;
  }
}

function buildAudioChain({ outSec, keepVideoAudio, haveBgAudio, ttsPath, leadInMs, tailSec, bgVol, ttsInputIndex = 1 }){
  let aChain = '';
  if (ttsPath && keepVideoAudio && haveBgAudio) {
    const bg = makeChain('0:a', [
      `adelay=${leadInMs}|${leadInMs}`,
      `volume=${bgVol.toFixed(2)}`,
      'aresample=48000',
      'aformat=sample_fmts=fltp:channel_layouts=stereo'
    ], 'bg');
    const tts1 = makeChain(`${ttsInputIndex}:a`, [
      `adelay=${leadInMs}|${leadInMs}`,
      'aresample=48000',
      'pan=stereo|c0=c0|c1=c0',
      'aformat=sample_fmts=fltp:channel_layouts=stereo',
      'asetpts=PTS-STARTPTS'
    ], 'tts1');
    const mix = `[bg][tts1]amix=inputs=2:duration=longest:dropout_transition=0 [aout]`;
    aChain = [bg, tts1, mix].join(';');
  } else if (ttsPath) {
    const tts1 = makeChain(`${ttsInputIndex}:a`, [
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
  // v2 overlay mode
  overlayCaption,
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

  // ---- PNG OVERLAY BRANCH: if captionImage exists, use overlay path and SKIP drawtext ----
  let usingCaptionPng = false;
  let captionPngPath = null;
  
  if (captionImage?.dataUrl) {
    usingCaptionPng = true;
    try {
      const { file: pngPath } = await saveDataUrlToTmp(captionImage.dataUrl, "caption");
      
      // Verify the PNG file exists and is readable
      if (fs.existsSync(pngPath) && fs.statSync(pngPath).size > 0) {
        captionPngPath = pngPath;
        console.log("[render] using caption PNG overlay:", pngPath);
        console.log("[render] USING OVERLAY - skipping drawtext. Caption PNG:", pngPath);
      } else {
        throw new Error("PNG file is empty or doesn't exist");
      }
    } catch (error) {
      console.warn("[render] failed to save or verify caption PNG, falling back to drawtext:", error.message);
      usingCaptionPng = false;
      captionPngPath = null;
    }
  }
  
  // Guard: Verify caption PNG path exists before using in ffmpeg
  if (usingCaptionPng && (!captionPngPath || !fs.existsSync(captionPngPath))) {
    console.warn("[render] Caption PNG path invalid or missing, falling back to drawtext");
    console.warn("[render] PNG path was:", captionPngPath);
    console.warn("[render] File exists:", captionPngPath ? fs.existsSync(captionPngPath) : false);
    usingCaptionPng = false;
    captionPngPath = null;
  }
  
  // Additional guard: Ensure PNG file is not empty
  if (usingCaptionPng && captionPngPath && fs.existsSync(captionPngPath)) {
    const stats = fs.statSync(captionPngPath);
    if (stats.size === 0) {
      console.warn("[render] Caption PNG file is empty, falling back to drawtext");
      usingCaptionPng = false;
      captionPngPath = null;
    } else {
      console.log(`[render] Caption PNG verified: ${captionPngPath} (${stats.size} bytes)`);
    }
  }

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
  
  // Check line_spacing support once per render
  const supportsLineSpacing = await hasLineSpacingOption();
  
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
          supportsLineSpacing && effLineSpacing > 0 ? `line_spacing=${effLineSpacing}` : null,
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
  const drawWatermark = watermark ? (() => {
    const watermarkFontFile = escapeFontPath(assertFontExists(resolveFontFile('normal', 'normal')));
    return `drawtext=${[
      `fontfile=${watermarkFontFile}`,
      `text='${escapeForDrawtext(watermarkText || 'Vaiform')}'`,
      `x=w-tw-${watermarkPadding}`, `y=h-th-${watermarkPadding}`,
      `fontsize=${watermarkFontSize}`, 'fontcolor=white',
      'shadowcolor=black','shadowx=2','shadowy=2','borderw=2','bordercolor=black@0.85','box=0'
    ].filter(Boolean).join(':')}`;
  })() : '';

  // Optional caption (bottom, safe area, wrapped)
  let drawCaption = '';
  
  // CRITICAL: Early raster mode guard - skip ALL caption drawtext paths
  if (overlayCaption?.mode === 'raster') {
    console.log('[render] RASTER MODE detected - skipping ALL caption drawtext paths');
    drawCaption = '';
  } else if (overlayCaption && overlayCaption.text) {
    console.log(`[render] USING OVERLAY MODE - SSOT positioning from computeOverlayPlacement`);
    
    // Normalize overlay caption to ensure all fields are present
    const normalized = normalizeOverlayCaption(overlayCaption);
    
    console.log('[render] Normalized overlayCaption (post-normalize):', {
      ssotVersion: normalized.ssotVersion,
      mode: normalized.mode,
      keys: Object.keys(normalized),
      totalTextH: normalized.totalTextH,
      totalTextHPx: normalized.totalTextHPx,
      yPxFirstLine: normalized.yPxFirstLine,
      splitLines: Array.isArray(normalized.splitLines) ? normalized.splitLines.length : 0,
      internalPadding: normalized.internalPadding,
      placement: normalized.placement,
      lineSpacingPx: normalized.lineSpacingPx
    });
    
    // Compute placement using shared SSOT helper (same math as preview)
    const placement = computeOverlayPlacement(normalized, W, H);
    
    // SSOT V3 RASTER MODE: Use PNG overlay instead of drawtext
    if (placement?.mode === 'raster' && placement.rasterUrl) {
      console.log('[raster] Using PNG overlay instead of drawtext');
      
      // CRITICAL: Log raster inputs for debugging
      console.log('[render:raster:IN]', {
        rasterW: placement.rasterW,
        rasterH: placement.rasterH,
        y: placement.y,
        wPct: normalized.wPct ?? placement.wPct ?? 1,
        xExpr: placement.xExpr
      });
      
      // CRITICAL: Log placement before materialization
      console.log('[v3:materialize:BEFORE]', {
        rasterUrl: placement.rasterUrl.substring(0, 50) + '...',
        rasterW: placement.rasterW,
        rasterH: placement.rasterH,
        y: placement.y,
        xExpr: placement.xExpr
      });
      
      // Download/materialize the raster PNG to a temp file
      let rasterTmpPath = null;
      try {
        rasterTmpPath = await fetchToTmp(placement.rasterUrl, '.png');
        
        if (!fs.existsSync(rasterTmpPath) || fs.statSync(rasterTmpPath).size === 0) {
          throw new Error('Raster PNG file is empty or missing');
        }
        
        // CRITICAL: Log after materialization to verify file integrity
        const fileStats = fs.statSync(rasterTmpPath);
        console.log('[v3:materialize:AFTER]', {
          path: rasterTmpPath,
          fileSize: fileStats.size,
          expectedRasterW: placement.rasterW,
          expectedRasterH: placement.rasterH,
          expectedY: placement.y,
          xExpr: placement.xExpr
        });
        
        // 🔒 VALIDATION GUARDS - fail fast on mismatches
        
        // GEOMETRY LOCK - fail if preview was made for different target dimensions
        if (placement.frameW && placement.frameW !== W) {
          throw new Error(`Preview was for ${placement.frameW}×${placement.frameH}, got ${W}×${H}. Regenerate preview.`);
        }
        if (placement.frameH && placement.frameH !== H) {
          throw new Error(`Preview was for ${placement.frameW}×${placement.frameH}, got ${W}×${H}. Regenerate preview.`);
        }
        
        // OVERLAY IDENTITY - verify PNG hash matches preview
        if (placement.rasterHash) {
          const pngBuffer = fs.readFileSync(rasterTmpPath);
          const actualHash = crypto.createHash('sha256').update(pngBuffer).digest('hex').slice(0, 16);
          if (actualHash !== placement.rasterHash) {
            throw new Error(`Overlay differs from preview (hash mismatch: ${actualHash} vs ${placement.rasterHash}). Regenerate preview.`);
          }
          console.log('[v3:hash] PNG integrity verified:', actualHash);
        }
        
        // MODE LOCK - only raster mode allowed for v3
        if (placement.mode !== 'raster') {
          throw new Error(`Expected mode='raster', got '${placement.mode}'. Regenerate preview.`);
        }
        
        console.log('[raster] Materialized PNG overlay:', {
          path: rasterTmpPath,
          size: fileStats.size,
          rasterW: placement.rasterW,
          rasterH: placement.rasterH,
          y: placement.y
        });
        
        // CRITICAL: Validate that dimensions match preview expectations
        if (placement.rasterW !== normalized.rasterW || placement.rasterH !== normalized.rasterH) {
          throw new Error(`Raster dimensions mismatch: expected ${normalized.rasterW}×${normalized.rasterH}, got ${placement.rasterW}×${placement.rasterH}`);
        }
        
        // Store raster details for buildVideoChain
        usingCaptionPng = true;
        captionPngPath = rasterTmpPath;
        
        // Warn if wPct is missing in normalized overlay
        if (!('wPct' in normalized)) {
          console.warn('[render] wPct missing; defaulting to 1');
        }
        
        // Store placement details for overlay filter - EXACT preview dimensions
        const rasterPlacement = {
          mode: 'raster',
          rasterW: placement.rasterW,  // Use exact preview dimensions
          rasterH: placement.rasterH,  // Use exact preview dimensions
          xExpr: placement.xExpr,
          y: placement.y,  // top of raster (yPx), already integer
          wPct: placement.wPct ?? normalized.wPct ?? 1  // Pass wPct for scaling - prioritize placement.wPct
        };
        
        // Skip drawtext - we'll use overlay filter instead
        drawCaption = '';
        
        console.log('[raster] overlay: x=' + rasterPlacement.xExpr + ', y=' + rasterPlacement.y + 
                    ', rasterW/H=' + rasterPlacement.rasterW + '×' + rasterPlacement.rasterH);
        
        // Proceed to buildVideoChain which will handle the overlay filter
        // (we'll need to modify buildVideoChain to accept raster placement)
        
      } catch (error) {
        console.error('[raster] Failed to materialize PNG overlay:', error.message);
        throw new Error(`Raster overlay failed: ${error.message}. Please regenerate preview.`);
      }
      
      // Skip the rest of the drawtext logic
      // Jump directly to buildVideoChain
    } else {
      // Extract computed values (let for reassignment in sanity checks)
      const useSSOT = placement?.willUseSSOT === true;
      let { 
        xExpr, y, fontPx: overlayFontPx, lineSpacingPx, totalTextH, 
        fromSavedPreview, splitLines, leftPx, windowW 
      } = placement;
    
    // Log SSOT values before drawtext
    console.log('[ffmpeg] Pre-drawtext SSOT:', {
      useSSOT,
      willUseSSOT: placement?.willUseSSOT,
      fontPx: overlayFontPx,
      lineSpacingPx,
      totalTextH,
      y,
      yPxFirstLine: normalized.yPxFirstLine,
      splitLines: splitLines?.length
    });
    
    // ===== SANITY CHECKS - Only apply to fallback values, not SSOT =====
    if (useSSOT) {
      // Trust SSOT values completely when willUseSSOT is true
      console.log('[ffmpeg] Using SSOT values verbatim');
    } else {
      // Apply sanity checks for fallback/legacy values
      if (!Number.isFinite(overlayFontPx) || overlayFontPx < 8 || overlayFontPx > 400) {
        console.warn(`[ffmpeg-sanity] Invalid fontPx=${overlayFontPx}, defaulting to 56`);
        overlayFontPx = 56;
      }
      
      if (!Number.isFinite(lineSpacingPx) || lineSpacingPx < 0 || lineSpacingPx > overlayFontPx * 3) {
        console.warn(`[ffmpeg-sanity] Invalid lineSpacingPx=${lineSpacingPx}, recomputing`);
        const lh = Math.round(overlayFontPx * 1.15);
        lineSpacingPx = Math.max(0, lh - overlayFontPx);
      }
      
      if (!Number.isFinite(totalTextH) || totalTextH <= 0) {
        console.warn(`[ffmpeg-sanity] Invalid totalTextH=${totalTextH}, recomputing`);
        const lines = (splitLines && splitLines.length) || 1;
        totalTextH = lines * Math.round(overlayFontPx * 1.15);
      }
      
      if (!Number.isFinite(y)) {
        console.warn(`[ffmpeg-sanity] Invalid y=${y}, recomputing from yPct`);
        const anchorY = Math.round((normalized.yPct ?? 0.1) * H);
        y = Math.round(anchorY - (totalTextH / 2));
      }
    }
    
    // Log placement for verification (match preview logging format)
    console.log(`[render] SSOT placement computed:`, {
      useSSOT,
      willUseSSOT: placement?.willUseSSOT,
      fromSavedPreview,
      mode: placement?.mode,
      xPct: normalized.xPct?.toFixed(3),
      yPct: normalized.yPct?.toFixed(3),
      wPct: normalized.wPct?.toFixed(3),
      fontPx: overlayFontPx,
      totalTextH,
      computedY: y,
      lineSpacingPx,
      xExpr,
      splitLines: splitLines?.length || 'unknown'
    });
    
    // Use overlay font settings
    const overlayColorRaw = normalized.color || '#ffffff';
    const overlayColor = normalizeColorForFFmpeg(overlayColorRaw);
    const overlayOpacity = normalized.opacity;
    
    // Resolve font file using SSOT registry
    const fontFile = assertFontExists(resolveFontFile(
      normalized.weightCss, 
      normalized.fontStyle || 'normal'
    ));
    
    // Log resolved font for debugging
    console.log('[render] SSOT font resolved:', {
      weightCss: normalized.weightCss,
      fontStyle: normalized.fontStyle,
      fontFile: fontFile
    });
    
    // Text to render: use saved splitLines if available, otherwise fallback to word-wrap
    let textToRender;
    if (useSSOT && splitLines && splitLines.length > 0) {
      // Use exact text from saved preview (SSOT) - don't rewrap!
      textToRender = splitLines.join('\n');  // Use actual newlines, escapeForDrawtext will handle escaping
      console.log(`[render] Using SSOT splitLines: ${splitLines.length} lines`);
    } else if (Array.isArray(splitLines) && splitLines.length > 0) {
      // Have splitLines but not SSOT mode (legacy path with saved lines)
      textToRender = splitLines.join('\n');  // Use actual newlines, escapeForDrawtext will handle escaping
      console.log(`[render] Using saved splitLines (legacy): ${splitLines.length} lines`);
    } else {
      // Fallback: word-wrap text
      textToRender = (normalized.text || '').replace(/\r\n/g, '\n');
      const hasLineBreaks = textToRender.includes('\n');
      
      if (!hasLineBreaks && textToRender.trim()) {
        // Create temporary canvas for text measurement
        const tempCanvas = createCanvas(W, H);
        const tempCtx = tempCanvas.getContext("2d");
        const fontString = `${normalized.weightCss || 'normal'} ${overlayFontPx}px DejaVuSans`;
        tempCtx.font = fontString;
        
        // Word-wrap using same logic as legacy caption path
        const maxWidth = windowW || Math.round(W * 0.92);
        const words = textToRender.split(/\s+/);
        const lines = [];
        let line = "";
        
        for (const word of words) {
          const test = line ? line + " " + word : word;
          if (tempCtx.measureText(test).width > maxWidth && line) {
            lines.push(line);
            line = word;
          } else {
            line = test;
          }
        }
        if (line) lines.push(line);
        
        textToRender = lines.join('\n');  // Use actual newlines, escapeForDrawtext will handle escaping
        console.log(`[render] word-wrapped text: ${lines.length} lines`);
      }
    }
    
    // Verify SSOT values before using them in drawtext
    console.log('[ffmpeg] overlayCaption SSOT values:', {
      fontPx: overlayFontPx,
      lineSpacingPx: lineSpacingPx,
      totalTextH: totalTextH,
      y: y,
      splitLines: splitLines?.length,
      xExpr: xExpr,
      supportsLineSpacing: supportsLineSpacing
    });
    
    // SSOT validation logging
    console.log('[SSOT-render] Drawing with:', {
      fontPx: overlayFontPx, 
      lineSpacingPx, 
      y,
      text: textToRender.substring(0, 40),
      hasLiteralBackslashN: textToRender.includes('\\n'),
      hasActualNewline: textToRender.includes('\n')
    });
    
    // Build drawtext filter with SSOT placement and escaped font path
    const fontfileArg = `fontfile=${escapeFontPath(fontFile)}`;
    drawCaption = `drawtext=${[
      fontfileArg,
      `text='${escapeForDrawtext(textToRender)}'`,
      `x=${xExpr}`, // Use computed expression from placement helper
      `y=${y}`, // Should be ~130 for yPct=0.1, not -3129
      `fontsize=${overlayFontPx}`, // Should be 54
      `fontcolor=${overlayColor}@${overlayOpacity}`,
      supportsLineSpacing && lineSpacingPx > 0 ? `line_spacing=${lineSpacingPx}` : null, // Should be ~8
      `borderw=2:bordercolor=black@0.85`,
      `shadowcolor=black:shadowx=2:shadowy=2`,
      `box=0`
    ].filter(Boolean).join(':')}`;
    
    // Enhanced diagnostic logging
    try { 
      console.log(JSON.stringify({ 
        tag:'render:payload', 
        mode:'overlayCaption', 
        fromSavedPreview,
        fontPx: overlayFontPx, 
        lineSpacingPx, 
        totalTextH, 
        y, 
        supportsLineSpacing, 
        textLength: textToRender.length, 
        lines: splitLines?.length || 'unknown'
      })); 
    } catch {}
    
    // CRITICAL: Log exact values being used in FFmpeg
    console.log('[ffmpeg] USING VALUES', {
      useSSOT,
      willUseSSOT: placement?.willUseSSOT,
      fromSavedPreview,
      fontPx: overlayFontPx,
      y,
      lineSpacingPx,
      xExpr,
      text: textToRender.substring(0, 50).replace(/\n/g, '\\n'),
      splitLines: splitLines?.length || 'unknown',
      lines: textToRender.split('\n').length
    });
    }  // End of else block for non-raster mode
  } else if (CAPTION_OVERLAY && captionImage) {
    console.log(`[render] USING OVERLAY - skipping drawtext. Caption PNG: ${captionImage.pngPath}`);
    drawCaption = '';
  } else if (!usingCaptionPng && caption && String(caption.text || '').trim()) {
    // Inputs
    const capTextRaw = String(caption.text || '').trim();
    const fittedFromPreview = (caption.fittedText && String(caption.fittedText).trim()) ? String(caption.fittedText).trim() : null;

    function scaleFontPx(fontSizePx = 32, previewH = 640) {
      const base = Math.max(1, Number(previewH) || 640);
      const px = Math.round((Number(fontSizePx) || 32) * (H / base));
      return Math.max(24, Math.min(140, px));
    }
    const oldFontPx = scaleFontPx(caption.fontSizePx, caption.previewHeightPx);

    // font file - use SSOT registry for consistent bold/italic detection
    const originalFontFile = assertFontExists(resolveFontFile(
      previewResolved?.weightCss || caption.fontWeight || caption.weight || 'normal',
      previewResolved?.fontStyle || 'normal'
    ));

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
    // Use SSOT font resolution for final font file
    const fontFile = assertFontExists(resolveFontFile(
      previewResolved?.weightCss || caption.fontWeight || caption.weight || 'normal',
      previewResolved?.fontStyle || 'normal'
    ));
    
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
      capText = lines.join('\n');  // Use actual newlines, escapeForDrawtext will handle escaping
    }

    // This section is now handled by the pure painter approach above

    // per-line drawtext (centered x) — raw expression in single quotes; avoid escaping commas here
    const xFinal = `'max(20\\,min(w-20-text_w\\,(w*0.5)-text_w/2))'`;
    const wantBox = !!(caption.box && (caption.box.enabled || caption.wantBox));
    const boxAlpha = Math.max(0, Math.min(1, Number(caption.box?.alpha ?? caption.boxAlpha ?? 0)));
    
    // If caption is required but no PNG overlay, fail explicitly
    if ((captionText || caption?.text) && !usingCaptionPng) {
      throw new Error("Caption resolution missing: overlay not provided");
    }
    
    // ---- Pure painter approach: use captionResolved verbatim when available (only if NOT using PNG) ----
    let usingResolved = !usingCaptionPng && !!(captionResolved && captionResolved.fontPx && Array.isArray(captionResolved.splitLines) && captionResolved.splitLines.length > 0);
    
    let fontPx, lineSpacing, strokeW, shadowX, shadowY, textAlpha, baseY, lines, n, _lineSp;
    
    // Safety check: if we have captionResolved but no valid splitLines, fail explicitly
    if (captionResolved && captionResolved.fontPx && (!Array.isArray(captionResolved.splitLines) || captionResolved.splitLines.length === 0)) {
      throw new Error("Caption resolution missing: overlay not provided");
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
      
      // Skip empty lines to avoid drawtext=textfile=''
      if (!line.trim()) continue;
      
      const xExpr = xFinal;
      const yExpr = `'max(20\\,min(h-20-${fontPx}\\,${lineY}))'`;
      
      // Write line to temp file for safe handling of special characters
      const lineTxtFile = writeCaptionTxt(line);

      // pass A — subtle blur-ish base (no stroke)
      const lineFontFile = escapeFontPath(assertFontExists(resolveFontFile(
        captionResolved?.weightCss || 'bold',
        captionResolved?.fontStyle || 'normal'
      )));
      capDraws.push(
        `drawtext=textfile='${lineTxtFile}'` +
        `:fontfile=${lineFontFile}` +
        `:x='${xExpr}'` +
        `:y='${yExpr}'` +
        `:fontsize=${fontPx}` +
        (supportsLineSpacing && _lineSp > 0 ? `:line_spacing=${_lineSp}` : '') +
        `:fontcolor=black@${(usingResolved ? (captionResolved?.shadowAlpha ?? 0.35) : 0.35).toFixed(2)}:borderw=0:shadowx=${shadowX}:shadowy=${shadowY}` +
        `:fix_bounds=1:text_shaping=1:box=0`
      );

      // pass B — second soften pass (no stroke)
      capDraws.push(
        `drawtext=textfile='${lineTxtFile}'` +
        `:fontfile=${lineFontFile}` +
        `:x='${xExpr}'` +
        `:y='${yExpr}'` +
        `:fontsize=${fontPx}` +
        (supportsLineSpacing && _lineSp > 0 ? `:line_spacing=${_lineSp}` : '') +
        `:fontcolor=black@0.25:borderw=0:shadowx=${shadowX + 1}:shadowy=${shadowY + 1}` +
        `:fix_bounds=1:text_shaping=1:box=0`
      );

      // pass C — main text last (so stroke isn't dimmed)
      capDraws.push(
        `drawtext=textfile='${lineTxtFile}'` +
        `:fontfile=${lineFontFile}` +
        `:x='${xExpr}'` +
        `:y='${yExpr}'` +
        `:fontsize=${fontPx}` +
        (supportsLineSpacing && _lineSp > 0 ? `:line_spacing=${_lineSp}` : '') +
        `:fontcolor=white@${textAlpha.toFixed(2)}` +
        `:borderw=${strokeW}:bordercolor=black@${(usingResolved ? (captionResolved?.strokeAlpha ?? 0.85) : 0.85).toFixed(2)}` +
        `:shadowx=0:shadowy=0` +
        `:fix_bounds=1:text_shaping=1:box=0`
      );
      }

      drawCaption = capDraws.join(',');
    }
  } else if (!usingCaptionPng && captionText && String(captionText).trim()) {
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
      supportsLineSpacing && cap.lineSpacing > 0 ? `line_spacing=${cap.lineSpacing}` : null,
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

  // CRITICAL: Log raster placement before passing to buildVideoChain
  const rasterPlacement = overlayCaption?.mode === 'raster' ? {
    mode: 'raster',
    rasterW: overlayCaption.rasterW,
    rasterH: overlayCaption.rasterH,
    xExpr: overlayCaption.xExpr || '(W-overlay_w)/2',
    y: overlayCaption.yPx
  } : null;
  
  console.log('[v3:buildChain:IN]', {
    usingCaptionPng,
    captionPngPath: captionPngPath ? 'present' : 'null',
    rasterPlacement: rasterPlacement ? {
      mode: rasterPlacement.mode,
      rasterW: rasterPlacement.rasterW,
      rasterH: rasterPlacement.rasterH,
      y: rasterPlacement.y,
      xExpr: rasterPlacement.xExpr
    } : null
  });

  // Runtime parity checklist for raster mode
  if (usingCaptionPng && rasterPlacement) {
    const checklist = {
      mode: 'raster',
      frameW: rasterPlacement.frameW,
      frameH: rasterPlacement.frameH,
      rasterW: rasterPlacement.rasterW,
      rasterH: rasterPlacement.rasterH,
      xExpr_png: rasterPlacement.xExpr,
      yPx_png: rasterPlacement.y,
      rasterPadding: rasterPlacement.rasterPadding,
      previewFontString: rasterPlacement.previewFontString,
      previewFontHash: rasterPlacement.previewFontHash,
      rasterHash: rasterPlacement.rasterHash,
      bgScaleExpr: rasterPlacement.bgScaleExpr,
      bgCropExpr: rasterPlacement.bgCropExpr,
      willScaleOverlay: false  // Design A enforced
    };
    console.log('[PARITY_CHECKLIST]', JSON.stringify(checklist, null, 2));
  }

  const vchain = buildVideoChain({ 
    width: W, 
    height: H, 
    videoVignette, 
    drawLayers: usingCaptionPng ? [drawMain, drawAuthor, drawWatermark].filter(Boolean) : [drawMain, drawAuthor, drawWatermark, drawCaption].filter(Boolean),
    captionImage: CAPTION_OVERLAY ? captionImage : null,
    usingCaptionPng,
    captionPngPath,
    rasterPlacement
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

  // Calculate correct TTS input index (PNG input shifts audio index)
  const ttsInputIndex = usingCaptionPng ? 2 : 1;
  const aChain = buildAudioChain({ outSec, keepVideoAudio, haveBgAudio, ttsPath, leadInMs, tailSec, bgVol, ttsInputIndex });

  // Assemble and log RAW vs FINAL filter_complex
  const rawFilter = [vchain, aChain].filter(Boolean).join(';');
  const finalFilter = (process.env.BYPASS_SANITIZE === '1') ? rawFilter : sanitizeFilter(rawFilter);
  console.log('[ffmpeg] RAW   -filter_complex:', rawFilter);
  console.log('[ffmpeg] FINAL -filter_complex:', finalFilter);

  // Assert raster parity constraints before spawning ffmpeg
  if (overlayCaption?.mode === 'raster') {
    assertRasterParity(overlayCaption, captionPngPath, finalFilter);
  }
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
    ...(usingCaptionPng && captionPngPath && fs.existsSync(captionPngPath) && fs.statSync(captionPngPath).size > 0 ? ['-i', captionPngPath] : []),
    ...(CAPTION_OVERLAY && captionImage && !usingCaptionPng ? ['-i', captionImage.pngPath || captionImage.localPath] : []),
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

  // Check line_spacing support for social image export
  const supportsLineSpacing = await hasLineSpacingOption();

  const drawMain = `drawtext=${[
    `text='${quoteTxt}'`,
    fontfile ? `fontfile='${fontfile}'` : null,
    `x=(w-text_w)/2`,
    `y=(h-text_h)/2`,
    `fontsize=${fit.fontsize}`,
    `fontcolor=${fontcolor}`,
    `shadowcolor=${shadowColor}`,`shadowx=${shadowX}`,`shadowy=${shadowY}`,
    `box=${box}`,`boxcolor=${boxcolor}`,`boxborderw=${boxborderw}`,
    supportsLineSpacing && effLineSpacing > 0 ? `line_spacing=${effLineSpacing}` : null,
    'borderw=0'
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
  const drawWatermark = watermark ? (() => {
    const watermarkFontFile = escapeFontPath(assertFontExists(resolveFontFile('normal', 'normal')));
    return `drawtext=${[
      `fontfile=${watermarkFontFile}`,
      `text='${escText(watermarkText || 'Vaiform')}'`,
      `x=w-tw-${watermarkPadding}`, `y=h-th-${watermarkPadding}`,
      `fontsize=${watermarkFontSize}`, 'fontcolor=white',
      'shadowcolor=black','shadowx=2','shadowy=2','box=1','boxcolor=black@0.25','boxborderw=12','borderw=0'
    ].filter(Boolean).join(':')}`;
  })() : '';

  const scale = `scale='min(iw*${H}/ih\,${W})':'min(ih*${W}/iw\,${H})':force_original_aspect_ratio=decrease`;
  const pad = `pad=${W}:${H}:ceil((${W}-iw)/2):ceil((${H}-ih)/2)`;
  const core = [ scale, pad, 'format=rgba', drawMain, drawAuthor, drawWatermark, 'format=yuv420p' ].filter(Boolean);
  const chain = makeChain('0:v', core, 'vout');
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


