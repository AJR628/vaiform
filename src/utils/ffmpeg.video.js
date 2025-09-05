import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";

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
}) {
  const main = esc(text || "");
  const author = authorLine ? esc(authorLine) : null;
  const wm = esc(watermarkText || "Vaiform");

  const cover = `scale='if(gt(a,${width}/${height}),-2,${width})':'if(gt(a,${width}/${height}),${height},-2)',crop=${width}:${height}`;
  const layers = [
    cover,
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
  const args = [
    "-i", videoPath,
    "-vf", vf,
    "-r", String(fps),
    "-t", String(durationSec),
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-an",
    outPath,
  ];
  await runFfmpeg(args);
}

export default { renderVideoQuoteOverlay };


