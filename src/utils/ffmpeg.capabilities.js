import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

let _hasSubtitles = null;
let _hasLineSpacing = null;

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

export async function hasLineSpacingOption() {
  // Allow env override for quick rollback: FORCE_LINE_SPACING=0/1
  const override = process.env.FORCE_LINE_SPACING;
  if (override !== undefined) {
    const result = override === '1' || override === 'true';
    console.log(`[ffmpeg] line_spacing capability forced via env: ${result}`);
    return result;
  }

  if (_hasLineSpacing !== null) return _hasLineSpacing;
  
  try {
    const ok = await new Promise((resolve) => {
      // Check drawtext filter options for line_spacing support
      const p = spawn(ffmpegPath, ["-hide_banner", "-h", "filter=drawtext"], { 
        stdio: ["ignore", "pipe", "pipe"] 
      });
      let out = "";
      p.stdout.on("data", d => (out += d.toString()));
      p.stderr.on("data", d => (out += d.toString()));
      p.on("close", () => {
        resolve(/\bline_spacing\b/.test(out));
      });
      p.on("error", () => resolve(false));
    });
    _hasLineSpacing = !!ok;
    console.log(`[ffmpeg] line_spacing capability detected: ${_hasLineSpacing}`);
  } catch {
    _hasLineSpacing = false;
    console.log('[ffmpeg] line_spacing capability check failed, assuming unsupported');
  }
  return _hasLineSpacing;
}

export default { hasSubtitlesFilter, hasLineSpacingOption };


