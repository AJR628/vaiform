import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { renderImageQuoteVideo } from "./ffmpeg.js";

// text/path helpers
const esc = s => String(s).replace(/\\/g,'\\\\').replace(/:/g,'\\:').replace(/'/g,"\\'");
function escText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n");
}
export function sanitizeFilter(graph) {
  const g = String(graph);
  // Split by ; into chains, then within each chain split by , and drop empties.
  const chains = g.split(';').map(ch =>
    ch
      .split(',')
      .map(p => p.trim())
      .filter(Boolean)              // remove empty filter nodes
      .join(',')
  ).filter(ch => ch.trim().length > 0);
  // Normalize spaces around separators, but NEVER touch [] labels.
  return chains.join(';').replace(/;\s+/g, ';').replace(/,\s+/g, ',');
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

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    // Log full args JSON for diagnostics
    try { console.log('[ffmpeg] spawn args JSON:', JSON.stringify(["-y", ...args])); } catch {}
    const p = spawn(ffmpegPath, ["-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
    p.on("exit", code => code === 0 ? resolve() : reject(new Error("ffmpeg_exit_"+code)));
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
  return { text: lines.join('\n'), fontsize: fz, lineSpacing };
}

function buildVideoChain({ width, height, videoVignette, drawLayers }){
  const W = Math.max(4, Number(width)||1080);
  const H = Math.max(4, Number(height)||1920);
  const scale = `scale='min(iw*${H}/ih\,${W})':'min(ih*${W}/iw\,${H})':force_original_aspect_ratio=decrease`;
  const pad = `pad=${W}:${H}:ceil((${W}-iw)/2):ceil((${H}-ih)/2)`;
  const core = [ scale, pad, (videoVignette ? 'vignette=PI/4:0.5' : null), 'format=yuv420p' ].filter(Boolean);
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
  const W = Math.max(4, Number(width)||1080);
  const H = Math.max(4, Number(height)||1920);
  const sm = (typeof safeMargin === 'number')
    ? (safeMargin <= 1 ? Math.round(Math.min(W,H) * clamp01(safeMargin)) : Math.round(safeMargin))
    : Math.round(Math.min(W,H) * 0.06);

  const fit = fitQuoteToBox({ text, boxWidthPx: W - sm*2, baseFontSize: fontsize || 72 });
  const quoteTxt = escText(fit.text);
  const effLineSpacing = Math.max(2, Number.isFinite(lineSpacing) ? lineSpacing : fit.lineSpacing);

  const drawMain = `drawtext=${[
    fontfile ? `fontfile='${fontfile}'` : null,
    `text='${quoteTxt}'`,
    `x=(w-text_w)/2`,
    `y=(h-text_h)/2`,
    `fontsize=${fit.fontsize}`,
    `fontcolor=${fontcolor}`,
    `shadowcolor=${shadowColor}`,`shadowx=${shadowX}`,`shadowy=${shadowY}`,
    `box=${box}`,`boxcolor=${boxcolor}`,`boxborderw=${boxborderw}`,
    `line_spacing=${effLineSpacing}`,'borderw=0'
  ].filter(Boolean).join(':')}`;
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

  const vchain = buildVideoChain({ width: W, height: H, videoVignette, drawLayers: [drawMain, drawAuthor, drawWatermark].filter(Boolean) });

  // ---- Audio chain builders ----
  const outSec = Math.max(0.1, Number(durationSec) || 8);
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

  const args = [
    '-y',
    '-i', videoPath,
    ...(ttsPath ? ['-i', ttsPath] : []),
    '-filter_complex', finalFilter,
    '-map', '[vout]', '-map', '[aout]',
    '-shortest',
    '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast',
    '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart',
    '-r', String(fps),
    '-t', String(outSec),
    outPath,
  ];
  try {
    await runFfmpeg(args);
  } catch (e) {
    const err = new Error('RENDER_FAILED');
    err.filter = finalFilter;
    err.cause = e;
    throw err;
  }
}

export async function exportPoster({ inPath, outPath, ssSec = 1, width = 1080, height = 1920 }){
  const args = [
    '-y',
    '-ss', String(ssSec),
    '-i', inPath,
    '-frames:v', '1',
    '-vf', `scale='min(iw*${height}/ih\,${width})':'min(ih*${width}/iw\,${height})':force_original_aspect_ratio=decrease,pad=${width}:${height}:ceil((${width}-iw)/2):ceil((${height}-ih)/2)`,
    '-f', 'image2', outPath,
  ];
  await runFfmpeg(args);
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
    await exportPoster({ inPath: outputs['9x16'], outPath: posterPath, ssSec: 1, width: 1080, height: 1920 });
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
    fontfile ? `fontfile='${fontfile}'` : null,
    `text='${quoteTxt}'`,
    `x=(w-text_w)/2`,
    `y=(h-text_h)/2`,
    `fontsize=${fit.fontsize}`,
    `fontcolor=${fontcolor}`,
    `shadowcolor=${shadowColor}`,`shadowx=${shadowX}`,`shadowy=${shadowY}`,
    `box=${box}`,`boxcolor=${boxcolor}`,`boxborderw=${boxborderw}`,
    `line_spacing=${effLineSpacing}`,'borderw=0'
  ].filter(Boolean).join(':')}`;
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


