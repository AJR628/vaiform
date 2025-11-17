import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import os from "os";
import path from "path";
import { writeCaptionFile } from "./captionFile.js";
import { fetchToTmp } from "./tmp.js";
import { hasLineSpacingOption } from "./ffmpeg.capabilities.js";

// Helper function to save dataUrl to temporary file
async function saveDataUrlToTmp(dataUrl, prefix = "caption") {
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

// Helper function to get image dimensions using ffprobe (with proper error handling)
async function getImageDimensions(imagePath) {
  try {
    const { spawn } = await import("child_process");
    const ffprobePath = ffmpegPath.replace("ffmpeg", "ffprobe");
    
    return new Promise((resolve, reject) => {
      const proc = spawn(ffprobePath, [
        "-v", "error",
        "-show_entries", "stream=width,height",
        "-of", "csv=p=0:s=x",
        imagePath
      ], { stdio: ["ignore", "pipe", "pipe"] });
      
      let stdout = "", stderr = "";
      proc.stdout.on("data", d => stdout += d.toString());
      proc.stderr.on("data", d => stderr += d.toString());
      
      proc.on("error", (err) => {
        console.warn("[getImageDimensions] spawn error:", err.message);
        resolve({ width: 1080, height: 1920 }); // fallback on spawn error
      });
      
      proc.on("close", (code) => {
        if (code === 0) {
          const [width, height] = stdout.trim().split("x").map(Number);
          if (width && height) {
            resolve({ width, height });
          } else {
            console.warn("[getImageDimensions] invalid dimensions, using defaults");
            resolve({ width: 1080, height: 1920 });
          }
        } else {
          console.warn("[getImageDimensions] ffprobe failed with code:", code, stderr);
          resolve({ width: 1080, height: 1920 }); // fallback on failure
        }
      });
    });
  } catch (error) {
    console.warn("[getImageDimensions] ffprobe failed, using defaults:", error.message);
    return { width: 1080, height: 1920 }; // fallback
  }
}

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
    let timeoutId;
    
    // Set timeout (default 300 seconds, overridable via opts.timeout)
    const timeoutMs = opts.timeout || 300000;
    
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

    // Set up timeout
    timeoutId = setTimeout(() => {
      if (proc && !proc.killed) {
        console.log(`[ffmpeg] Timeout after ${timeoutMs}ms, killing process`);
        proc.kill('SIGKILL');
        const err = new Error(`FFmpeg timeout after ${timeoutMs}ms`);
        err.code = "FFMPEG_TIMEOUT";
        err.stderr = stderr;
        reject(err);
      }
    }, timeoutMs);

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", (err) => {
      clearTimeout(timeoutId);
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
      clearTimeout(timeoutId);
      if (code === 0) return resolve({ code, stdout, stderr });
      const err = new Error(`ffmpeg exited with code ${code}${stderr ? ": " + stderr : ""}`);
      err.code = code;
      err.stderr = stderr;
      reject(err);
    });
  });
}
export function progressOverlayExpr({ widthVar = "w", heightVar = "h", durationSec = 8 }) {
  const BAR_W = `min(${widthVar}-160\\,900)`;
  const FILL_W = `${BAR_W}*min(1\\,t/${Math.max(1, durationSec)})`;
  const X_BAR = `(${widthVar}-${BAR_W})/2`;
  const Y_BAR = `${heightVar}-200`;
  const track = `drawbox=x=${X_BAR}:y=${Y_BAR}:w=${BAR_W}:h=12:color=white@0.18:t=fill`;
  const fill  = `drawbox=x=${X_BAR}:y=${Y_BAR}:w=${FILL_W}:h=12:color=white@0.85:t=fill:enable='between(t,0,${durationSec})'`;
  return `${track},${fill}`;
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
export async function renderSolidQuoteVideo({ outPath, text, durationSec = 8, template = "minimal", authorLine, assPath, progressBar = false, watermark = (process.env.WATERMARK_ENABLED ?? "true") !== "false", watermarkText = process.env.WATERMARK_TEXT || "Vaiform", watermarkFontSize = Number(process.env.WATERMARK_FONT_SIZE || 30), watermarkPadding = Number(process.env.WATERMARK_PADDING || 42) }) {
  if (!outPath) throw new Error("outPath is required");
  if (!text || !String(text).trim()) throw new Error("text is required");

  const width = 1080;
  const height = 1920;
  const fps = 24;

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

  let filter;
  if (assPath) {
    const esc = (p) => {
      let out = String(p).replace(/\\/g, "/");
      out = out.replace(/^([A-Za-z]):\//, "$1\\:/");
      out = out.replace(/:/g, "\\:").replace(/'/g, "\\'");
      return out;
    };
    filter = `subtitles='${esc(assPath)}'`;
    if (authorLine && String(authorLine).trim()) {
      const safeAuthor = escapeDrawtext(String(authorLine).trim());
      const author = `drawtext=text='${safeAuthor}'${fontOpt}:fontcolor=white@0.85:fontsize=36:shadowcolor=black@0.5:shadowx=1:shadowy=1:box=0:x=(w-text_w)/2:y=h/2+120`;
      filter = `${filter},${author}`;
    }
  } else {
    // Use textfile= to avoid all escaping issues
    const captionFile = writeCaptionFile(String(text).trim());
    const mainLine = `drawtext=fontfile=${escapeFilterPath(fontPath || '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')}:textfile=${escapeFilterPath(captionFile)}:reload=0:fontcolor=white:fontsize=64:line_spacing=8:shadowcolor=black@0.6:shadowx=2:shadowy=2:box=1:boxcolor=black@0.35:boxborderw=24:x=(w-text_w)/2:y=(h-text_h)/2`;
    filter = mainLine;
    if (authorLine && String(authorLine).trim()) {
      const safeAuthor = escapeDrawtext(String(authorLine).trim());
      const author = `drawtext=text='${safeAuthor}'${fontOpt}:fontcolor=white@0.85:fontsize=36:shadowcolor=black@0.5:shadowx=1:shadowy=1:box=0:x=(w-text_w)/2:y=h/2+120`;
      filter = `${mainLine},${author}`;
    }
  }
  if (progressBar) {
    const ov = progressOverlayExpr({ durationSec });
    filter = `${filter},${ov}`;
  }
  if (watermark) {
    const escTxt = escapeDrawtext(String(watermarkText));
    const wm = `drawtext=text='${escTxt}'${fontOpt}:fontcolor=white:fontsize=${watermarkFontSize}:shadowcolor=black:shadowx=2:shadowy=2:box=1:boxcolor=black@0.25:boxborderw=12:x=w-tw-${watermarkPadding}:y=h-th-${watermarkPadding}`;
    filter = `${filter},${wm}`;
  }

  const args = [
    "-f", "lavfi",
    "-i", `color=c=${bg}:s=${width}x${height}:d=${durationSec}`,
    "-vf", filter,
    "-r", String(fps),
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-an",
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

export async function renderImageQuoteVideo({
  outPath,
  imagePath,
  width = 1080,
  height = 1920,
  durationSec = 8,
  fps = 24,
  text,
  fontfile,
  fontcolor = "white",
  fontsize = 72,
  lineSpacing = 12,
  shadowColor = "black",
  shadowX = 2,
  shadowY = 2,
  box = 1,
  boxcolor = "black@0.35",
  boxborderw = 24,
  authorLine,
  authorFontsize = 36,
  authorMargin = 64,
  kenBurns = "in",
  assPath,
  progressBar = false,
  watermark = (process.env.WATERMARK_ENABLED ?? "true") !== "false",
  watermarkText = process.env.WATERMARK_TEXT || "Vaiform",
  watermarkFontSize = Number(process.env.WATERMARK_FONT_SIZE || 30),
  watermarkPadding = Number(process.env.WATERMARK_PADDING || 42),
  // Caption overlay support (SSOT)
  captionImage,
  captionResolved,
  captionText,
  caption,
  // SSOT v2 overlay caption support
  overlayCaption,
  // Audio support (SSOT)
  ttsPath,
}) {
  if (!outPath) throw new Error("outPath is required");
  if (!imagePath) throw new Error("imagePath is required");
  if (!text || !String(text).trim()) throw new Error("text is required");

  console.log(`[renderImageQuoteVideo] Starting image video render: ${imagePath} -> ${outPath}`);
  
  // SSOT v2: Extract overlay caption values if available
  let effectiveFontSize = fontsize;
  let effectiveLineSpacing = lineSpacing;
  let effectiveFontColor = fontcolor;
  let effectiveText = text;
  let usingSSOT = false;
  
  if (overlayCaption && (overlayCaption.ssotVersion === 2 || overlayCaption.ssotVersion === 3)) {
    console.log('[renderImageQuoteVideo] Using SSOT v' + overlayCaption.ssotVersion + ' overlayCaption');
    console.log('[renderImageQuoteVideo] SSOT values:', {
      fontPx: overlayCaption.fontPx,
      lineSpacingPx: overlayCaption.lineSpacingPx,
      totalTextH: overlayCaption.totalTextH,
      yPxFirstLine: overlayCaption.yPxFirstLine,
      xPct: overlayCaption.xPct,
      yPct: overlayCaption.yPct,
      color: overlayCaption.color,
      opacity: overlayCaption.opacity,
      fontFamily: overlayCaption.fontFamily,
      weightCss: overlayCaption.weightCss,
      lines: overlayCaption.lines?.length || 0
    });
    
    // Use SSOT values instead of defaults
    if (Number.isFinite(overlayCaption.fontPx)) {
      effectiveFontSize = overlayCaption.fontPx;
    }
    if (Number.isFinite(overlayCaption.lineSpacingPx)) {
      effectiveLineSpacing = overlayCaption.lineSpacingPx;
    }
    if (overlayCaption.color) {
      effectiveFontColor = overlayCaption.color;
    }
    if (overlayCaption.text) {
      effectiveText = overlayCaption.text;
    }
    usingSSOT = true;
  }
  
  const safeText = escapeDrawtext(String(effectiveText).trim());
  const fontPath = fontfile || resolveFont();
  const fontOpt = fontPath ? `:fontfile=${escapeFilterPath(fontPath)}` : "";

  // Simplified approach: create an 8s mp4 from a still image
  // Use basic scaling and cropping without complex Ken Burns
  const cover = `scale='if(gt(a,${width}/${height}),-2,${width})':'if(gt(a,${width}/${height}),${height},-2)',crop=${width}:${height}`;

  // Ken Burns effect using on-based ramp (SSOT)
  let kb = null;
  if (kenBurns) {
    const fps = 24;
    const dur = durationSec;
    const zoomMax = 1.05;
    const zoomMin = 1.0;
    const zoomExpr = `${zoomMin} + (${zoomMax - zoomMin}) * on / (${fps} * ${dur})`;
    kb = `zoompan=z='${zoomExpr}':d=1:s=${width}x${height}:fps=${fps}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
  }

  // ---- CAPTION OVERLAY BRANCH: if captionImage exists, use overlay path and SKIP drawtext ----
  let usingCaptionPng = false;
  let captionPngPath = null;
  
  // 🔒 EARLY PNG MATERIALIZATION - read directly from overlayCaption for raster mode
  if (overlayCaption?.mode === 'raster') {
    const dataUrl = overlayCaption.rasterUrl || overlayCaption.rasterDataUrl || overlayCaption.rasterPng;
    
    console.log('[renderImageQuoteVideo:v3:materialize:CHECK]', {
      hasRasterUrl: Boolean(overlayCaption.rasterUrl),
      hasRasterDataUrl: Boolean(overlayCaption.rasterDataUrl),
      rasterUrlLen: dataUrl?.length || 0
    });
    
    if (!dataUrl) {
      throw new Error('RASTER: missing rasterDataUrl/rasterUrl');
    }
    
    try {
      usingCaptionPng = true;
      captionPngPath = await fetchToTmp(dataUrl, '.png');
      
      console.log('[renderImageQuoteVideo:raster-guard]', {
        usingCaptionPng: true,
        captionPngPath
      });
      
      // Verify PNG file
      if (!fs.existsSync(captionPngPath) || fs.statSync(captionPngPath).size === 0) {
        throw new Error('RASTER: PNG file is empty or missing');
      }
      
      console.log('[renderImageQuoteVideo:v3:materialize:AFTER]', {
        path: captionPngPath,
        fileSize: fs.statSync(captionPngPath).size
      });
    } catch (error) {
      console.error('[renderImageQuoteVideo:raster] Failed to materialize PNG overlay:', error.message);
      throw new Error(`Raster overlay failed: ${error.message}. Please regenerate preview.`);
    }
  } else if (captionImage?.dataUrl) {
    usingCaptionPng = true;
    try {
      const { file: pngPath } = await saveDataUrlToTmp(captionImage.dataUrl, "caption");
      
      // Verify the PNG file exists and is readable
      if (fs.existsSync(pngPath) && fs.statSync(pngPath).size > 0) {
        captionPngPath = pngPath;
        console.log("[renderImageQuoteVideo] using caption PNG overlay:", pngPath);
        console.log("[renderImageQuoteVideo] USING OVERLAY - skipping drawtext. Caption PNG:", pngPath);
      } else {
        throw new Error("PNG file is empty or doesn't exist");
      }
    } catch (error) {
      console.warn("[renderImageQuoteVideo] failed to save or verify caption PNG, falling back to drawtext:", error.message);
      usingCaptionPng = false;
      captionPngPath = null;
    }
  }
  
  // Guard: Verify caption PNG path exists before using in ffmpeg
  if (usingCaptionPng && (!captionPngPath || !fs.existsSync(captionPngPath))) {
    console.warn("[renderImageQuoteVideo] Caption PNG path invalid or missing, falling back to drawtext");
    console.warn("[renderImageQuoteVideo] PNG path was:", captionPngPath);
    console.warn("[renderImageQuoteVideo] File exists:", captionPngPath ? fs.existsSync(captionPngPath) : false);
    usingCaptionPng = false;
    captionPngPath = null;
  }
  
  // Additional guard: Ensure PNG file is not empty
  if (usingCaptionPng && captionPngPath && fs.existsSync(captionPngPath)) {
    const stats = fs.statSync(captionPngPath);
    if (stats.size === 0) {
      console.warn("[renderImageQuoteVideo] Caption PNG file is empty, falling back to drawtext");
      usingCaptionPng = false;
      captionPngPath = null;
    } else {
      console.log(`[renderImageQuoteVideo] Caption PNG verified: ${captionPngPath} (${stats.size} bytes)`);
    }
  }

  const layers = [cover, kb, "format=yuv420p"].filter(Boolean);
  
  if (assPath) {
    const esc = (p) => {
      let out = String(p).replace(/\\/g, "/");
      out = out.replace(/^([A-Za-z]):\//, "$1\\:/");
      out = out.replace(/:/g, "\\:").replace(/'/g, "\\'");
      return out;
    };
    layers.push(`subtitles='${esc(assPath)}'`);
    if (authorLine && String(authorLine).trim()) {
      const safeAuthor = escapeDrawtext(String(authorLine).trim());
      const author = `drawtext=text='${safeAuthor}'${fontOpt}:fontcolor=${fontcolor}:fontsize=${authorFontsize}:shadowcolor=${shadowColor}:shadowx=${shadowX}:shadowy=${shadowY}:box=0:x=(w-text_w)/2:y=(h/2)+220`;
      layers.push(author);
    }
  } else if (!usingCaptionPng) {
    // Use textfile= to avoid all escaping issues (only if not using caption PNG overlay)
    const captionFile = writeCaptionFile(String(effectiveText).trim());
    
    // SSOT v2: Use effective values for positioning and styling
    let yPosition = "(h-text_h)/2"; // Default center
    if (usingSSOT && overlayCaption) {
      if (Number.isFinite(overlayCaption.yPxFirstLine)) {
        // Use exact yPxFirstLine from SSOT
        yPosition = `${overlayCaption.yPxFirstLine}`;
        console.log('[renderImageQuoteVideo] Using SSOT yPxFirstLine:', yPosition);
      } else if (Number.isFinite(overlayCaption.yPct) && Number.isFinite(overlayCaption.totalTextH)) {
        // Calculate from yPct and totalTextH
        const yPct = overlayCaption.yPct;
        const totalTextH = overlayCaption.totalTextH;
        const targetTop = (yPct * height) - (totalTextH / 2);
        yPosition = Math.max(50, Math.min(targetTop, height - 200 - totalTextH)).toString();
        console.log('[renderImageQuoteVideo] Calculated from SSOT yPct:', { yPct, totalTextH, targetTop, yPosition });
      }
    }
    
    // Check line_spacing support before using it
    const supportsLineSpacing = await hasLineSpacingOption();
    
    const mainLine = `drawtext=fontfile=${escapeFilterPath(fontPath || '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')}:textfile=${escapeFilterPath(captionFile)}:reload=0:fontcolor=${effectiveFontColor}:fontsize=${effectiveFontSize}${supportsLineSpacing && effectiveLineSpacing > 0 ? `:line_spacing=${effectiveLineSpacing}` : ''}:shadowcolor=${shadowColor}:shadowx=${shadowX}:shadowy=${shadowY}:box=${box}:boxcolor=${boxcolor}:boxborderw=${boxborderw}:x=(w-text_w)/2:y=${yPosition}`;
    layers.push(mainLine);
    if (authorLine && String(authorLine).trim()) {
      const safeAuthor = escapeDrawtext(String(authorLine).trim());
      const author = `drawtext=text='${safeAuthor}'${fontOpt}:fontcolor=${effectiveFontColor}:fontsize=${authorFontsize}:shadowcolor=${shadowColor}:shadowx=${shadowX}:shadowy=${shadowY}:box=0:x=(w-text_w)/2:y=(h/2)+220`;
      layers.push(author);
    }
  } else {
    // Using caption PNG overlay - skip drawtext for main text, but still add author if present
    if (authorLine && String(authorLine).trim()) {
      const safeAuthor = escapeDrawtext(String(authorLine).trim());
      const author = `drawtext=text='${safeAuthor}'${fontOpt}:fontcolor=${fontcolor}:fontsize=${authorFontsize}:shadowcolor=${shadowColor}:shadowx=${shadowX}:shadowy=${shadowY}:box=0:x=(w-text_w)/2:y=(h/2)+220`;
      layers.push(author);
    }
  }
  if (progressBar) {
    layers.push(progressOverlayExpr({ durationSec }));
  }
  if (watermark) {
    const escTxt = escapeDrawtext(String(watermarkText));
    const wm = `drawtext=text='${escTxt}'${fontOpt}:fontcolor=${fontcolor}:fontsize=${watermarkFontSize}:shadowcolor=${shadowColor}:shadowx=2:shadowy=2:box=1:boxcolor=black@0.25:boxborderw=12:x=w-tw-${watermarkPadding}:y=h-th-${watermarkPadding}`;
    layers.push(wm);
  }

  // Build filter with optional caption PNG overlay using SSOT scaling and positioning (PROBE-FREE)
  let vf;
  if (usingCaptionPng && captionPngPath && fs.existsSync(captionPngPath)) {
    // Use SSOT placement data from overlayCaption (raster mode) or fallback to legacy
    const W = width, H = height;
    
    // Determine scale and crop expressions - prefer SSOT from preview
    let scale, crop;
    if (overlayCaption?.bgScaleExpr && overlayCaption?.bgCropExpr) {
      // Use EXACT expressions from preview (SSOT v3 raster mode)
      scale = overlayCaption.bgScaleExpr;
      crop = overlayCaption.bgCropExpr;
      console.log('[renderImageQuoteVideo] Using preview geometry:', { scale, crop });
    } else {
      // Fallback to default scaling
      scale = `scale='if(gt(a,${W}/${H}),-2,${W})':'if(gt(a,${W}/${H}),${H},-2)'`;
      crop = `crop=${W}:${H}`;
    }
    
    // Determine overlay position - prefer SSOT absolute coordinates
    let overlayX, overlayY;
    
    if (overlayCaption?.mode === 'raster') {
      // SSOT v3 raster mode: use exact placement from preview
      // Prefer absolute X if available, otherwise use expression
      if (Number.isFinite(overlayCaption.xPx_png)) {
        overlayX = String(Math.trunc(overlayCaption.xPx_png));
        console.log('[renderImageQuoteVideo:raster:x-absolute]', { xPx_png: overlayCaption.xPx_png, overlayX });
      } else {
        overlayX = (overlayCaption.xExpr_png || overlayCaption.xExpr || '(W-overlay_w)/2').replace(/\s+/g, '');
        console.log('[renderImageQuoteVideo:raster:x-expression]', { overlayX });
      }
      
      // Use yPx_png from SSOT (required for raster mode)
      if (Number.isFinite(overlayCaption.yPx_png)) {
        overlayY = String(Math.trunc(overlayCaption.yPx_png));
      } else if (Number.isFinite(overlayCaption.yPx)) {
        overlayY = String(Math.trunc(overlayCaption.yPx));
      } else {
        overlayY = '24'; // Fallback
        console.warn('[renderImageQuoteVideo:raster] Missing yPx_png, using fallback');
      }
      
      console.log('[renderImageQuoteVideo:v3:parity] Using preview dimensions verbatim:', {
        rasterW: overlayCaption.rasterW,
        rasterH: overlayCaption.rasterH,
        xExpr: overlayX,
        y: overlayY
      });
    } else if (usingSSOT && overlayCaption) {
      // SSOT v2: Calculate from yPxFirstLine or yPct
      overlayX = "(w-overlay_w)/2"; // Center horizontally
      if (Number.isFinite(overlayCaption.yPxFirstLine)) {
        overlayY = overlayCaption.yPxFirstLine.toString();
        console.log(`[renderImageQuoteVideo] Using SSOT v2 yPxFirstLine: ${overlayY}`);
      } else if (Number.isFinite(overlayCaption.yPct) && Number.isFinite(overlayCaption.totalTextH)) {
        const yPct = overlayCaption.yPct;
        const totalTextH = overlayCaption.totalTextH;
        const targetTop = (yPct * H) - (totalTextH / 2);
        const safeTopMargin = 50;
        const safeBottomMargin = H * 0.08;
        overlayY = Math.max(safeTopMargin, Math.min(targetTop, H - safeBottomMargin - totalTextH)).toString();
        console.log(`[renderImageQuoteVideo] SSOT v2 yPct calculation: yPct=${yPct}, totalTextH=${totalTextH}, overlayY=${overlayY}`);
      } else {
        overlayY = "0";
      }
    } else if (captionResolved?.xPx !== undefined && captionResolved?.yPx !== undefined) {
      // Legacy: Use precise SSOT coordinates from caption preview API
      overlayX = captionResolved.xPx.toString();
      overlayY = captionResolved.yPx.toString();
      console.log(`[renderImageQuoteVideo] Using legacy SSOT coordinates: xPx=${overlayX}, yPx=${overlayY}`);
    } else {
      // Default fallback
      overlayX = "(w-overlay_w)/2";
      overlayY = "0";
      console.log(`[renderImageQuoteVideo] Using default positioning: x=${overlayX}, y=${overlayY}`);
    }
    
    // Build filter graph - skip Ken Burns for raster mode (still images don't need zoompan)
    const core = [scale, crop, 'format=rgba'].filter(Boolean);
    const baseChain = `[0:v]${core.join(',')}[vmain]`;
    const pngPrep = `[1:v]format=rgba[ovr]`;
    // Determine end format based on output type (will be set later if still image)
    const endFormat = 'format=yuv420p';
    const overlayExpr = `[vmain][ovr]overlay=${overlayX}:${overlayY}:format=auto,${endFormat}[vout]`;
    
    vf = `${baseChain};${pngPrep};${overlayExpr}`;
    
    console.log(`[renderImageQuoteVideo] Using SSOT overlay filter: ${vf}`);
    console.log(`[renderImageQuoteVideo:raster:FFMPEG]`, {
      actualRasterW: overlayCaption?.rasterW,
      actualRasterH: overlayCaption?.rasterH,
      overlayX,
      overlayY,
      noScaling: overlayCaption?.mode === 'raster',
      willScaleOverlay: false
    });
  } else {
    vf = layers.join(",");
    console.log(`[renderImageQuoteVideo] Filter: ${vf}`);
  }

  // Build args with optional caption PNG overlay and TTS audio
  const hasTTS = ttsPath && fs.existsSync(ttsPath);
  const ttsInputIndex = usingCaptionPng ? 2 : 1; // TTS is input 2 if caption PNG is present, otherwise input 1
  
  // Determine output format: still image if no TTS and using caption overlay, otherwise MP4
  const isStillImage = !hasTTS && usingCaptionPng && captionPngPath && fs.existsSync(captionPngPath);
  const outExt = path.extname(outPath).toLowerCase();
  
  // If we want a still image but the extension is .mp4, change it to .png
  let finalOutPath = outPath;
  if (isStillImage && outExt === '.mp4') {
    finalOutPath = outPath.replace(/\.mp4$/i, '.png');
    console.log(`[renderImageQuoteVideo] Changing output from .mp4 to .png for still image: ${finalOutPath}`);
  }
  const isImageFormat = isStillImage && (outExt === '.png' || outExt === '.jpg' || outExt === '.jpeg' || outExt === '.mp4');
  
  // Update filter for still image output (use rgba format for PNG transparency)
  if (isImageFormat && usingCaptionPng && captionPngPath && fs.existsSync(captionPngPath)) {
    const finalExt = path.extname(finalOutPath).toLowerCase();
    if (finalExt === '.png') {
      // For PNG, replace yuv420p with rgba format to preserve transparency
      vf = vf.replace(/format=yuv420p/g, 'format=rgba');
      console.log(`[renderImageQuoteVideo] Updated filter for PNG output with transparency`);
    }
  }
  
  let args;
  if (isImageFormat) {
    // Render as still image (PNG/JPEG)
    console.log(`[renderImageQuoteVideo] Rendering still image: ${path.extname(finalOutPath)}`);
    args = [
      "-i", imagePath,
      ...(usingCaptionPng && captionPngPath && fs.existsSync(captionPngPath) && fs.statSync(captionPngPath).size > 0 ? ['-i', captionPngPath] : []),
      ...(usingCaptionPng && captionPngPath && fs.existsSync(captionPngPath) ? ['-filter_complex', vf, '-map', '[vout]'] : ['-vf', vf]),
      "-frames:v", "1",
      "-f", "image2",
      finalOutPath,
    ];
    console.log(`[render.image] Still image mode: inputs img=${imagePath} cap=${usingCaptionPng ? captionPngPath : 'none'}`);
  } else {
    // Render as MP4 video
    console.log(`[renderImageQuoteVideo] Rendering MP4 video`);
    args = [
      "-loop", "1",
      "-t", String(durationSec),
      "-i", imagePath,
      ...(usingCaptionPng && captionPngPath && fs.existsSync(captionPngPath) && fs.statSync(captionPngPath).size > 0 ? ['-i', captionPngPath] : []),
      ...(hasTTS ? ['-i', ttsPath] : []),
      ...(usingCaptionPng && captionPngPath && fs.existsSync(captionPngPath) ? ['-filter_complex', vf, '-map', '[vout]'] : ['-vf', vf]),
      ...(hasTTS ? ['-map', `${ttsInputIndex}:a`] : []),
      "-r", String(fps),
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      ...(hasTTS ? ['-c:a', 'aac', '-b:a', '192k', '-shortest'] : ['-an']),
      finalOutPath,
    ];
    
    // Log audio mapping details
    if (hasTTS) {
      console.log(`[audio.map] TTS input index: ${ttsInputIndex}, map="[vout]" + "${ttsInputIndex}:a" aac 192k`);
    } else {
      console.log(`[audio.map] No TTS audio - using silent video (-an)`);
    }
  }

  // Log inputs and filter before spawn
  console.log(`[render.image] inputs: img=${imagePath} cap=${usingCaptionPng ? captionPngPath : 'none'} tts=${hasTTS ? ttsPath : 'none'}`);
  console.log(`[render.image] filter_complex: "${vf}"`);
  console.log(`[audio.map] map="[vout]" + "${hasTTS ? ttsInputIndex : 'none'}:a"`);
  
  const startTime = Date.now();
  try {
    await runFFmpeg(args, { timeout: 120000 }); // 2 minute timeout
    const duration = Date.now() - startTime;
    console.log(`[render.image] done in ${duration}ms`);
    console.log(`[renderImageQuoteVideo] Successfully rendered: ${finalOutPath}`);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[render.image] ffmpeg failed code=${error.code} after ${duration}ms`);
    console.error(`[render.image] stderr: ${String(error.stderr || '').slice(0, 2000)}`);
    console.error(`[render.image] args:`, args);
    
    // Enhanced error reporting for debugging
    const enhancedError = new Error(`Image render failed: ${error.message}`);
    enhancedError.code = error.code;
    enhancedError.stderr = error.stderr;
    enhancedError.args = args;
    enhancedError.filterComplex = vf;
    enhancedError.duration = duration;
    throw enhancedError;
  }
  
  return finalOutPath;
}

export default {
  runFFmpeg,
  escapeDrawtext,
  resolveFont,
  renderSolidQuoteVideo,
  renderImageQuoteVideo,
};


