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

  // Build video chain
  const vNodes = [
    '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease',
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
    '[vout]'
  ].filter(Boolean).join(',');

  // Audio chain with 1s lead-in and 1s tail
  const outSec = Math.max(0.1, Number(durationSec) || 8);
  const leadInMs = 1000;
  const tailSec = 1.0;
  const aParts = [];
  if (ttsPath) {
    aParts.push(`[1:a]adelay=${leadInMs}|${leadInMs},atrim=0:${Math.max(0.1, outSec - tailSec)},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=mono,aresample=48000,pan=stereo|c0=c0|c1=c0[tts]`);
    if (keepVideoAudio && haveBgAudio) {
      aParts.push(`[0:a]atrim=0:${outSec},asetpts=PTS-STARTPTS,volume=${Number(bgAudioVolume).toFixed(3)}[bg]`);
      if (duckDuringTTS) {
        aParts.push(`[bg][tts]sidechaincompress=threshold=${duck.threshold ?? -18}:ratio=${duck.ratio ?? 8}:attack=${duck.attack ?? 40}:release=${duck.release ?? 250}[ducked]`);
        aParts.push(`[ducked][tts]amix=inputs=2:duration=longest:dropout_transition=0[aout]`);
      } else {
        aParts.push(`[bg][tts]amix=inputs=2:duration=longest:dropout_transition=0[aout]`);
      }
    } else {
      aParts.push('[tts]anull[aout]');
    }
  } else {
    if (keepVideoAudio && haveBgAudio) {
      aParts.push(`[0:a]atrim=0:${outSec},asetpts=PTS-STARTPTS,volume=${Number(bgAudioVolume).toFixed(3)}[aout]`);
    }
  }
  const aChain = aParts.filter(Boolean).join(';');

  let filterParts = [vNodes, aChain].filter(Boolean).join(';');
  filterParts = sanitizeFilter(filterParts);
  console.log('[ffmpeg] -filter_complex:', filterParts);

  const args = [
    '-y',
    '-i', videoPath,
    ...(ttsPath ? ['-i', ttsPath] : []),
    '-filter_complex', filterParts,
    '-map', '[vout]',
    ...(aChain ? ['-map', '[aout]'] : ['-an']),
    '-t', String(outSec),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    ...(aChain ? ['-c:a', 'aac', '-b:a', '192k'] : []),
    '-movflags', '+faststart',
    outPath,
  ];
  await runFfmpeg(args);
}

export default { renderVideoQuoteOverlay };


