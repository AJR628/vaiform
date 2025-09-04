import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Spawn ffmpeg with -y and provided args. Resolves on exit code 0, rejects otherwise.
 * Captures stdout/stderr for diagnostics.
 */
export function runFFmpeg(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const finalArgs = ["-y", "-hide_banner", "-loglevel", "error", ...args];
    let stdout = "";
    let stderr = "";
    let proc;
    try {
      if (!ffmpegPath) {
        const e = new Error("FFMPEG_NOT_AVAILABLE: ffmpeg-static path not resolved");
        e.code = "FFMPEG_NOT_AVAILABLE";
        throw e;
      }
      proc = spawn(ffmpegPath, finalArgs, {
        cwd: opts.cwd || process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
    } catch (err) {
      const notFound = err?.code === "ENOENT";
      const message = err?.code === "FFMPEG_NOT_AVAILABLE"
        ? "FFMPEG_NOT_AVAILABLE: ffmpeg-static path not resolved"
        : notFound
          ? "ffmpeg binary not found. Please install ffmpeg and ensure it is in PATH."
          : (err?.message || "Failed to spawn ffmpeg");
      const e = new Error(message);
      e.code = err?.code || (notFound ? "FFMPEG_NOT_FOUND" : "SPAWN_ERROR");
      return reject(e);
    }

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", (err) => {
      const notFound = err?.code === "ENOENT";
      const message = notFound
        ? "ffmpeg binary not found. Please install ffmpeg and ensure it is in PATH."
        : (err?.message || "ffmpeg process error");
      const e = new Error(message);
      e.code = notFound ? "FFMPEG_NOT_FOUND" : (err?.code || "PROC_ERROR");
      e.stderr = stderr;
      reject(e);
    });
    proc.on("close", (code) => {
      if (code === 0) return resolve({ code, stdout, stderr });
      const err = new Error(`ffmpeg exited with code ${code}${stderr ? ": " + stderr : ""}`);
      err.code = code;
      err.stderr = stderr;
      reject(err);
    });
  });
}

/**
 * Escape characters that are special in drawtext text values.
 * Escapes: backslash, colon, percent, single-quote
 */
export function escapeDrawtext(text) {
  if (text == null) return "";
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%")
    .replace(/'/g, "\\'");
}

/**
 * Escape a path used inside an ffmpeg filter option (e.g., drawtext fontfile=...)
 * Handles Windows drive letters and backslashes. Converts Windows paths to forward slashes
 * and escapes colon after drive letter.
 */
function escapeFilterPath(p) {
  if (!p) return p;
  // Normalize Windows to forward slashes to minimize escaping complexity
  let out = p.replace(/\\/g, "/");
  // Escape drive letter colon if present (e.g., C:/ -> C\:/)
  out = out.replace(/^([A-Za-z]):\//, "$1\\:/");
  return out;
}

/**
 * Resolve a font path.
 * - Use process.env.FONT_PATH if provided
 * - Else return common DejaVu Sans path (Linux). If not present, return null (let ffmpeg pick default).
 */
export function resolveFont() {
  const fromEnv = (process.env.FONT_PATH || "").trim();
  if (fromEnv) return fromEnv;

  const candidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/usr/local/share/fonts/dejavu/DejaVuSans.ttf",
    // Windows common fallbacks (use forward slashes)
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
    // macOS
    "/System/Library/Fonts/Supplemental/Arial.ttf",
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return null; // let ffmpeg choose default
}

/**
 * Render a simple solid-color vertical quote video with subtle Ken Burns motion.
 * @param {object} p
 * @param {string} p.outPath - Output MP4 path
 * @param {string} p.text - Quote text
 * @param {number} [p.durationSec=8]
 * @param {"calm"|"bold"|"cosmic"|"minimal"} [p.template="minimal"]
 */
export async function renderSolidQuoteVideo({ outPath, text, durationSec = 8, template = "minimal" }) {
  if (!outPath) throw new Error("outPath is required");
  if (!text || !String(text).trim()) throw new Error("text is required");

  const width = 1080;
  const height = 1920;
  const fps = 24;
  const frames = Math.max(1, Math.round(fps * durationSec));

  // Palette based on template
  const bgMap = {
    calm: "0x0b1725",      // deep navy
    bold: "0x111111",      // near-black
    cosmic: "0x160b2e",    // dark purple
    minimal: "0x141414",   // dark gray
  };
  const bg = bgMap[template] || bgMap.minimal;

  // Text styling
  const safeText = escapeDrawtext(String(text).trim());
  const fontPath = resolveFont();
  const fontOpt = fontPath ? `:fontfile=${escapeFilterPath(fontPath)}` : "";

  // Zoom from 1.0 to ~1.06 across the duration
  const zoomExpr = `min(1.06,1+0.06*(on/${frames}))`;
  const filter = [
    `zoompan=z=${zoomExpr}:d=1:x=(iw-iw/zoom)/2:y=(ih-ih/zoom)/2:s=${width}x${height}`,
    // Draw centered text with soft shadow and semi-transparent box
    `drawtext=text=${safeText}${fontOpt}:fontcolor=white:fontsize=64:line_spacing=8:shadowcolor=black@0.6:shadowx=2:shadowy=2:box=1:boxcolor=black@0.35:boxborderw=24:x=(w-text_w)/2:y=(h-text_h)/2`
  ].join(",");

  const args = [
    "-f", "lavfi",
    "-i", `color=c=${bg}:s=${width}x${height}:d=${durationSec}`,
    "-vf", filter,
    "-r", String(fps),
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-t", String(durationSec),
    outPath,
  ];

  try {
    await runFFmpeg(args);
  } catch (err) {
    if (err?.code === "FFMPEG_NOT_FOUND") throw err;
    throw err;
  }
}

export default {
  runFFmpeg,
  escapeDrawtext,
  resolveFont,
  renderSolidQuoteVideo,
};


