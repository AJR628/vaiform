import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

let _hasSubtitles = null;

export async function hasSubtitlesFilter() {
  if (_hasSubtitles !== null) return _hasSubtitles;
  try {
    const ok = await new Promise((resolve) => {
      const p = spawn(ffmpegPath, ["-hide_banner", "-filters"], { stdio: ["ignore", "pipe", "ignore"] });
      let out = "";
      p.stdout.on("data", d => (out += d.toString()));
      p.on("close", () => {
        resolve(/\b(subtitles|ass)\b/.test(out));
      });
      p.on("error", () => resolve(false));
    });
    _hasSubtitles = !!ok;
  } catch {
    _hasSubtitles = false;
  }
  return _hasSubtitles;
}

export default { hasSubtitlesFilter };


