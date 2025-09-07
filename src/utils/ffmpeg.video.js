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
    .replace(/,{2,}/g, ',')
    .replace(/;{2,}/g, ';')
    .replace(/^,|,$/g, '')
    .replace(/^;|;$/g, '');
}

// safe builders
const joinF = (parts) => parts.filter(Boolean).join(',');
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

  // Build video chain with array-safe join
  const vin = '[0:v]';
  const vlabel = out('vout');
  const videoParts = [
    `${vin}scale=1080:1920:force_original_aspect_ratio=decrease`,
    'pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
    (videoVignette ? 'vignette=PI/4:0.5' : null),
    'format=yuv420p',
    `drawtext=${[
      fontfile ? `fontfile='${fontfile}'` : null,
      `text='${quoteTxt}'`,
      'x=(w-text_w)/2','y=(h-text_h)/2',
      `fontsize=${fitted.fontsize}`,`fontcolor=${fontcolor}`,
      `shadowcolor=${shadowColor}`,`shadowx=${shadowX}`,`shadowy=${shadowY}`,
      `box=${box}`,`boxcolor=${boxcolor}`,`boxborderw=${boxborderw}`,
      `line_spacing=${fitLineSpacing}`,'borderw=0'
    ].filter(Boolean).join(':')}`,
    (authorLine && String(authorLine).trim()
      ? `drawtext=${[
          fontfile ? `fontfile='${fontfile}'` : null,
          `text='${escText(String(authorLine).trim())}'`,
          'x=(w-text_w)/2', 'y=(h+th)/2+80',
          `fontsize=${Math.max(32, Math.round(fitted.fontsize * 0.5))}`,
          `fontcolor=${fontcolor}`,
          `shadowcolor=${shadowColor}`,`shadowx=${shadowX}`,`shadowy=${shadowY}`,
          'box=0','borderw=0'
        ].filter(Boolean).join(':')}`
      : null),
    (watermark ? `drawtext=${[
      fontfile ? `fontfile='${fontfile}'` : null,
      `text='${escText(watermarkText || 'Vaiform')}'`,
      `x=w-tw-${watermarkPadding}`, `y=h-th-${watermarkPadding}`,
      `fontsize=${watermarkFontSize}`, 'fontcolor=white',
      'shadowcolor=black','shadowx=2','shadowy=2','box=1','boxcolor=black@0.25','boxborderw=12','borderw=0'
    ].filter(Boolean).join(':')}` : null),
    vlabel,
  ];
  const vChain = joinF(videoParts);

  // ---- Audio chain ----
  const outSec = Math.max(0.1, Number(durationSec) || 8);
  const envDelay = Number(process.env.TTS_DELAY_MS ?? 1000);
  const envTailMs = Number(process.env.TTS_TAIL_MS ?? 800);
  const leadInMs = Number(ttsDelayMs ?? envDelay) || 0;
  const tailMs = Number.isFinite(Number(tailPadSec)) ? Number(tailPadSec) * 1000 : envTailMs;
  const tailSec = Number.isFinite(Number(tailPadSec)) ? Number(tailPadSec) : (envTailMs / 1000);

  const ain = '[1:a]';
  const alabel = out('aout');
  const vol = Number.isFinite(Number(bgAudioVolume)) ? Number(bgAudioVolume) : 0.1;

  let aChain = '';
  const tts1 = ttsPath ? j([
    `${ain}adelay=${leadInMs}|${leadInMs}`,
    'aresample=48000',
    'aformat=sample_fmts=fltp:channel_layouts=stereo',
    'pan=stereo|c0=c0|c1=c0',
    'anlmdn=s=0.0005:p=0.0002',
    'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=summary',
    'asetpts=PTS-STARTPTS',
    'anull',
    '[tts1]'
  ]) : '';
  const bg = (haveBgAudio && keepVideoAudio)
    ? j([
        `[0:a]volume=${Number(bgAudioVolume ?? 0.35).toFixed(2)}`,
        'aresample=48000',
        '[bg]'
      ])
    : '';
  const ttsOnly = (!keepVideoAudio && ttsPath)
    ? j([
        tts1,
        `anullsrc=r=48000:cl=stereo:d=${tailSec}[sil]`,
        '[tts1][sil]concat=n=2:v=0:a=1[aout]'
      ])
    : '';
  const mix = (haveBgAudio && keepVideoAudio && ttsPath)
    ? (duckDuringTTS
        ? j([
            tts1,
            bg,
            `[bg][tts1]sidechaincompress=threshold=${duck.threshold ?? -18}:ratio=${duck.ratio ?? 8}:attack=${duck.attack ?? 40}:release=${duck.release ?? 250}[ducked]`,
            `[ducked][tts1]amix=inputs=2:duration=longest:dropout_transition=0,aresample=48000[aout]`
          ])
        : j([
            tts1,
            bg,
            '[tts1][bg]amix=inputs=2:duration=longest:dropout_transition=0,aresample=48000[aout]'
          ]))
    : '';
  const bgOnly = (!haveBgAudio && keepVideoAudio)
    ? j([
        '[0:a]aresample=48000[aout]'
      ])
    : '';
  aChain = j([ mix || '', bgOnly || '', (!keepVideoAudio ? ttsOnly : '') ]);

  let filterParts = [vChain, aChain].filter(Boolean).join(';');
  filterParts = sanitizeFilter(filterParts);
  console.log('[ffmpeg] -filter_complex:', filterParts);

  const args = [
    '-y',
    '-i', videoPath,
    ...(ttsPath ? ['-i', ttsPath] : []),
    '-filter_complex', filterParts,
    '-map', '[vout]',
    '-map', '[aout]',
    '-t', String(outSec),
    '-shortest',
    '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast',
    '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart',
    outPath,
  ];
  try {
    await runFfmpeg(args);
  } catch (e) {
    const err = new Error('RENDER_FAILED');
    err.filter = filterParts;
    err.cause = e;
    throw err;
  }
}

export default { renderVideoQuoteOverlay };


