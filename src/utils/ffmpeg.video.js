import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { buildAudioMixArgs } from "./audio.mix.js";

const esc = s => String(s).replace(/\\/g,'\\\\').replace(/:/g,'\\:').replace(/'/g,"\\\\'");

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
  const main = esc(text || "");
  const author = authorLine ? esc(authorLine) : null;
  const wm = esc(watermarkText || "Vaiform");

  const cover = `scale='if(gt(a,${width}/${height}),-2,${width})':'if(gt(a,${width}/${height}),${height},-2)',crop=${width}:${height}`;
  const layers = [
    cover,
    (videoVignette ? 'vignette' : null),
    "format=yuv420p",
    `drawtext=${[
      fontfile ? `fontfile='${fontfile}'` : null,
      `text='${main}'`,
      "x=(w-text_w)/2", "y=(h-text_h)/2",
      `fontsize=${fontsize}`, `fontcolor=${fontcolor}`,
      `shadowcolor=${shadowColor}`, `shadowx=${shadowX}`, `shadowy=${shadowY}`,
      `box=${box}`, `boxcolor=${boxcolor}`, `boxborderw=${boxborderw}`,
      `line_spacing=${lineSpacing}`, "borderw=0"
    ].filter(Boolean).join(":")}`
  ];

  if (author) {
    layers.push(`drawtext=${[
      fontfile ? `fontfile='${fontfile}'` : null,
      `text='${author}'`,
      "x=(w-text_w)/2", `y=(h/2)+220`,
      `fontsize=${authorFontsize}`, `fontcolor=${fontcolor}`,
      `shadowcolor=${shadowColor}`, `shadowx=${shadowX}`, `shadowy=${shadowY}`,
      "box=0", "borderw=0"
    ].filter(Boolean).join(":")}`);
  }

  if (watermark) {
    layers.push(`drawtext=${[
      fontfile ? `fontfile='${fontfile}'` : null,
      `text='${wm}'`,
      `x=w-tw-${watermarkPadding}`, `y=h-th-${watermarkPadding}`,
      `fontsize=${watermarkFontSize}`, "fontcolor=white",
      "shadowcolor=black", "shadowx=2", "shadowy=2",
      "box=1", "boxcolor=black@0.25", "boxborderw=12", "borderw=0"
    ].filter(Boolean).join(":")}`);
  }

  const vf = layers.join(",");
  // Assume bg audio present; ffmpeg will no-op if not
  const audio = buildAudioMixArgs({
    haveBgAudio,
    bgAudioStream: "0:a",
    ttsPath,
    keepVideoAudio,
    bgAudioVolume,
    duckDuringTTS,
    duck,
    applyFade: true,
    durationSec,
  });
  const filterParts = [`${vf}[vout]`, audio.filterComplex].filter(Boolean).join(";");
  console.log('[ffmpeg] -filter_complex:', filterParts);
  const args = [
    "-i", videoPath,
    ...(videoStartSec > 0 ? ["-ss", String(videoStartSec)] : []),
    "-t", String(durationSec),
    ...audio.extraInputs,
    "-filter_complex", filterParts,
    "-map", "[vout]",
    ...(audio.mapAudio.length ? audio.mapAudio : ["-an"]),
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    ...(audio.codecAudio || []),
    "-shortest",
    outPath,
  ];
  await runFfmpeg(args);
}

export default { renderVideoQuoteOverlay };


