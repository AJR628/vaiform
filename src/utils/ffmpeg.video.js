import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";

// text/path helpers
const esc = s => String(s).replace(/\\/g,'\\\\').replace(/:/g,'\\:').replace(/'/g,"\\'");
function escText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n");
}
function sanitizeFilter(s) {
  return String(s)
    .replace(/[ \t]+/g, ' ')
    .replace(/;{2,}/g, ';')
    .replace(/(^|;)\s+/g, '$1')
    .replace(/\s+($|;)/g, '$1')
    .trim();
}

// safe builders
const joinF = (parts) => parts.filter(Boolean).join(';');
const seg = (...parts) => parts.filter(Boolean).join(',');
const out = (label) => label ? `[${label}]` : '';
function j(parts, sep=';') {
  return parts.filter(p => typeof p === 'string' && p.trim().length > 0).join(sep);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ["-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
    p.on("exit", code => code === 0 ? resolve() : reject(new Error("ffmpeg_exit_"+code)));
  });
}

export async function renderVideoQuoteOverlay({
  videoPath, outPath, width = 1080, height = 1920,
  durationSec = 8, fps = 24,
  text, fontfile, fontcolor = "white", fontsize = 72, lineSpacing = 12,
  shadowColor = "black", shadowX = 2, shadowY = 2,
  box = 1, boxcolor = "black@0.35", boxborderw = 24,
  authorLine, authorFontsize = 36,
  watermark = true, watermarkText = "Vaiform", watermarkFontSize = 30, watermarkPadding = 42,
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
  // Fit + wrap quote text for 1080x1920
  function fitQuoteFor1080(txt) {
    const raw = String(txt || '').trim().replace(/\s+/g, ' ');
    let fz = 72;
    const len = raw.length;
    if (len > 140) fz = 40; else if (len > 110) fz = 48; else if (len > 90) fz = 56; else if (len > 70) fz = 64;
    const maxChars = Math.max(16, Math.floor(900 / (fz * 0.55)));
    const words = raw.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const next = line ? line + ' ' + w : w;
      if (next.length <= maxChars) line = next; else { if (line) lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    return { text: lines.join('\n'), fontsize: fz };
  }

  const fitted = fitQuoteFor1080(text);
  const quoteTxt = escText(fitted.text);
  const fitLineSpacing = Math.round(fitted.fontsize * 0.25);

  // Build video chain using seg/joinF and out('vout')
  const vNodes = seg(
    '0:v',
    'scale=1080:1920:force_original_aspect_ratio=decrease',
    'pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
    (videoVignette ? 'vignette=PI/4:0.5' : null),
    'format=yuv420p'
  );
  const drawMain = `drawtext=${[
    fontfile ? `fontfile='${fontfile}'` : null,
    `text='${quoteTxt}'`,
    'x=(w-text_w)/2','y=(h-text_h)/2',
    `fontsize=${fitted.fontsize}`,`fontcolor=${fontcolor}`,
    `shadowcolor=${shadowColor}`,`shadowx=${shadowX}`,`shadowy=${shadowY}`,
    `box=${box}`,`boxcolor=${boxcolor}`,`boxborderw=${boxborderw}`,
    `line_spacing=${fitLineSpacing}`,'borderw=0'
  ].filter(Boolean).join(':')}`;
  const drawAuthor = (authorLine && String(authorLine).trim()) ? `drawtext=${[
    fontfile ? `fontfile='${fontfile}'` : null,
    `text='${escText(String(authorLine).trim())}'`,
    'x=(w-text_w)/2', 'y=(h+th)/2+80',
    `fontsize=${Math.max(32, Math.round(fitted.fontsize * 0.5))}`,
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
  const vchain = joinF([ vNodes, drawMain, drawAuthor, drawWatermark, out('vout') ]);

  // ---- Audio chain builders ----
  const outSec = Math.max(0.1, Number(durationSec) || 8);
  const envDelay = Number(process.env.TTS_DELAY_MS ?? 1000);
  const envTailMs = Number(process.env.TTS_TAIL_MS ?? 800);
  const leadInMs = Math.round(
    (Number.isFinite(Number(voiceoverDelaySec)) ? Number(voiceoverDelaySec) : (Number.isFinite(Number(ttsDelayMs)) ? Number(ttsDelayMs)/1000 : envDelay/1000)) * 1000
  );
  const tailSec = Math.max(0, Number.isFinite(Number(tailPadSec)) ? Number(tailPadSec) : (envTailMs/1000));
  const bgVol = Math.min(1, Math.max(0, Number.isFinite(Number(bgAudioVolume)) ? Number(bgAudioVolume) : 0.35));

  const mkBg = (ms, vol) => joinF([
    seg('0:a', `adelay=${ms}|${ms}`),
    `volume=${vol.toFixed(2)}`,
    'aresample=48000',
    'aformat=sample_fmts=fltp:channel_layouts=stereo',
    out('bg')
  ]);
  const mkTts = (ms) => joinF([
    seg('1:a', `adelay=${ms}|${ms}`),
    'aresample=48000',
    'pan=stereo|c0=c0|c1=c0',
    'aformat=sample_fmts=fltp:channel_layouts=stereo',
    'asetpts=PTS-STARTPTS',
    out('tts1')
  ]);
  const mkSil = (sec) => `anullsrc=r=48000:cl=stereo:d=${Math.max(0.1, Number(sec)||0.8)}[sil]`;

  let aChain = '';
  if (ttsPath && keepVideoAudio && haveBgAudio) {
    const bg = mkBg(leadInMs, bgVol);
    const tts = mkTts(leadInMs);
    const mix = duckDuringTTS
      ? `[bg][tts1]sidechaincompress=threshold=${duck.threshold ?? -18}:ratio=${duck.ratio ?? 8}:attack=${duck.attack ?? 40}:release=${duck.release ?? 250}[ducked];[ducked][tts1]amix=inputs=2:duration=longest:dropout_transition=0[aout]`
      : `[bg][tts1]amix=inputs=2:duration=longest:dropout_transition=0[aout]`;
    aChain = joinF([bg, tts, mix]);
  } else if (ttsPath) {
    const tts = mkTts(leadInMs);
    const sil = mkSil(tailSec);
    const cat = '[tts1][sil]concat=n=2:v=0:a=1[aout]';
    aChain = joinF([tts, sil, cat]);
  } else if (keepVideoAudio && haveBgAudio) {
    const bg = mkBg(leadInMs, bgVol).replace(out('bg'), out('aout'));
    aChain = bg;
  } else {
    aChain = `anullsrc=r=48000:cl=stereo:d=${Math.max(0.8, outSec || 0.8)}[aout]`;
  }

  // Assemble and log RAW vs FINAL filter_complex
  const rawFilter = [vchain, aChain].filter(Boolean).join(';');
  const BYPASS_SANITIZE = process.env.BYPASS_SANITIZE === '1';
  const finalFilter = BYPASS_SANITIZE ? rawFilter : sanitizeFilter(rawFilter);
  if (rawFilter.split(';').some(seg => !seg.trim())) {
    console.warn('[ffmpeg][warn] EMPTY FILTER SEGMENTS in rawFilter');
  }
  if (finalFilter.includes(';;')) {
    console.warn('[ffmpeg][warn] DOUBLE-SEMICOLON in final -filter_complex');
  }
  console.log('[ffmpeg] RAW   -filter_complex:', rawFilter);
  console.log('[ffmpeg] FINAL -filter_complex:', finalFilter);

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
    '-t', String(outSec),
    outPath,
  ];
  console.log('[ffmpeg] args about to spawn:', args.join(' '));
  try {
    await runFfmpeg(args);
  } catch (e) {
    const err = new Error('RENDER_FAILED');
    err.filter = finalFilter;
    err.cause = e;
    throw err;
  }
}

export default { renderVideoQuoteOverlay };


