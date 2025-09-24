import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// TASK 6: Improved font registration with @napi-rs/canvas
const fontPath = path.resolve('assets/fonts/DejaVuSans-Bold.ttf');
let fontRegistered = false;

// Check available fonts first
try {
  const availableFonts = GlobalFonts.families;
  console.log('[caption] Available system fonts:', availableFonts.slice(0, 10));
} catch (err) {
  console.log('[caption] Could not list system fonts');
}

if (fs.existsSync(fontPath)) {
  try {
    // TASK 6: Try multiple registration methods for better compatibility
    try {
      // Method 1: Direct path registration
      GlobalFonts.register(fontPath, 'DejaVu-Bold');
      fontRegistered = true;
      console.log('[caption] Font registered successfully: DejaVu-Bold (path method)');
    } catch (pathErr) {
      try {
        // Method 2: Buffer registration
        const fontBuffer = fs.readFileSync(fontPath);
        GlobalFonts.register(fontBuffer, 'DejaVu-Bold');
        fontRegistered = true;
        console.log('[caption] Font registered successfully: DejaVu-Bold (buffer method)');
      } catch (bufferErr) {
        // Method 3: Try with different family name
        try {
          GlobalFonts.register(fontPath, 'DejaVuSans-Bold');
          fontRegistered = true;
          console.log('[caption] Font registered successfully: DejaVuSans-Bold (alt name)');
        } catch (altErr) {
          console.warn('[caption] All font registration methods failed:');
          console.warn('[caption] Path error:', pathErr.message);
          console.warn('[caption] Buffer error:', bufferErr.message);
          console.warn('[caption] Alt name error:', altErr.message);
        }
      }
    }
  } catch (err) {
    console.warn('[caption] Font registration setup failed:', err.message);
  }
} else {
  console.warn('[caption] Font file not found:', fontPath);
}

if (!fontRegistered) {
  console.warn('[caption] Using system font fallback - DejaVu-Bold will not be available');
}

/**
 * @typedef {Object} CaptionStyle
 * @property {string} text - The text to render
 * @property {'DejaVuSans'} fontFamily - Font family
 * @property {400|700} fontWeight - Font weight
 * @property {number} fontPx - Font size in pixels at 1080×1920
 * @property {number} lineSpacingPx - Line spacing in pixels
 * @property {'left'|'center'|'right'} align - Text alignment
 * @property {number} textAlpha - Text opacity 0..1
 * @property {string} fill - Text color e.g. 'rgba(255,255,255,1)'
 * @property {number} strokePx - Stroke width in pixels
 * @property {string} strokeColor - Stroke color e.g. 'rgba(0,0,0,0.85)'
 * @property {number} shadowX - Shadow offset X
 * @property {number} shadowY - Shadow offset Y
 * @property {number} shadowBlur - Shadow blur radius
 * @property {string} shadowColor - Shadow color
 * @property {number} boxXPx - Caption box X position
 * @property {number} boxYPx - Caption box Y position
 * @property {number} boxWPx - Caption box width
 * @property {number} boxHPx - Caption box height
 * @property {number} [canvasW] - Canvas width (default 1080)
 * @property {number} [canvasH] - Canvas height (default 1920)
 */

/**
 * @typedef {Object} CaptionImage
 * @property {string} pngPath - Local temp path to PNG
 * @property {string} [publicUrl] - Storage URL if uploaded
 * @property {number} xPx - Trimmed image X position
 * @property {number} yPx - Trimmed image Y position
 * @property {number} wPx - Trimmed image width
 * @property {number} hPx - Trimmed image height
 * @property {Object} meta - Metadata about the rendering
 * @property {string[]} meta.lines - Wrapped text lines
 * @property {number[]} meta.baselines - Y positions of each line
 * @property {number} meta.fontPx - Font size used
 * @property {number} meta.lineSpacingPx - Line spacing used
 */

/**
 * Render a caption as a PNG image with precise text layout
 * @param {string} jobId - Job identifier for temp file naming
 * @param {CaptionStyle} style - Caption styling parameters
 * @returns {Promise<CaptionImage>} Rendered caption image info
 */
export async function renderCaptionImage(jobId, style) {
  if (!style?.text?.trim()) {
    throw new Error('Caption text is required and cannot be empty');
  }

  const {
    text,
    fontFamily = 'DejaVuSans',
    fontWeight = 700,
    fontPx = 44,
    lineSpacingPx = 52,
    align = 'center',
    textAlpha = 1.0,
    fill = 'rgba(255,255,255,1)',
    strokePx = 3,
    strokeColor = 'rgba(0,0,0,0.85)',
    shadowX = 0,
    shadowY = 2,
    shadowBlur = 4,
    shadowColor = 'rgba(0,0,0,0.55)',
    boxXPx = 42,
    boxYPx = 230,
    boxWPx = 996,
    boxHPx = 400,
    canvasW = 1080,
    canvasH = 1920,
  } = style;

  // Create canvas
  const canvas = createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d');

  // Set font with fallbacks for better compatibility
  const fontName = fontRegistered ? 'DejaVu-Bold' : 'Arial, sans-serif';
  ctx.font = `${fontWeight || 700} ${fontPx}px ${fontName}`;
  console.log(`[caption] Font set to: ${ctx.font} (registered: ${fontRegistered})`);
  ctx.textBaseline = 'top';

  // Word wrap text to fit within box width
  const words = text.trim().split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    
    if (metrics.width <= boxWPx && currentLine) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  }
  
  if (currentLine) {
    lines.push(currentLine);
  }

  if (lines.length === 0) {
    throw new Error('No valid text lines after word wrapping');
  }

  // Server-side font clamping - more conservative to prevent overflow
  let clampedFontPx = fontPx;
  const SAFE_W = Math.floor(canvasW * 0.90);   // 5% pad each side
  const SAFE_H = Math.floor(canvasH * 0.80);   // leave 10% top/btm combined for padding
  
  // Clamp font size to prevent text from running off page
  while (true) {
    const testHeight = lines.length * clampedFontPx + (lines.length - 1) * lineSpacingPx;
    if (testHeight <= SAFE_H) break;
    clampedFontPx -= 2; // Decrease by 2px for smoother transitions
    if (clampedFontPx <= 24) break; // Minimum 24px
  }
  
  // Calculate total text height with clamped font
  let totalTextHeight = lines.length * clampedFontPx + (lines.length - 1) * lineSpacingPx;
  
  // Max-height clamp (80% of 1920) - if text block exceeds, scale font down and re-wrap
  const maxHeightPx = Math.round(canvasH * 0.80); // 80% of 1920 = 1536px (more conservative)
  let finalFontPx = clampedFontPx; // Use the already-clamped font size
  let finalLines = lines;
  let finalLineSpacing = lineSpacingPx;
  
  if (totalTextHeight > maxHeightPx) {
    console.log(`[caption] Text height ${totalTextHeight}px exceeds max ${maxHeightPx}px, scaling down font`);
    
    // Scale font down proportionally
    const scaleFactor = maxHeightPx / totalTextHeight;
    finalFontPx = Math.max(24, Math.round(clampedFontPx * scaleFactor)); // Minimum 24px
    finalLineSpacing = Math.round(lineSpacingPx * scaleFactor);
    
    // Re-wrap with smaller font
    ctx.font = `${fontWeight || 700} ${finalFontPx}px ${fontName}`;
    const newLines = [];
    let currentLine = '';
    
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width <= boxWPx && currentLine) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          newLines.push(currentLine);
        }
        currentLine = word;
      }
    }
    
    if (currentLine) {
      newLines.push(currentLine);
    }
    
    finalLines = newLines;
    totalTextHeight = finalLines.length * finalFontPx + (finalLines.length - 1) * finalLineSpacing;
    console.log(`[caption] Scaled to fontPx=${finalFontPx}, lines=${finalLines.length}, height=${totalTextHeight}px`);
  }
  
  // Position text based on placement setting using full canvas dimensions
  let startY;
  const placement = style.placement || 'center';
  
  // Define safe margins for the full canvas
  const safeTopMargin = Math.max(50, canvasH * 0.05); // 5% from top, min 50px
  const safeBottomMargin = Math.max(50, canvasH * 0.08); // 8% from bottom, min 50px
  
  switch (placement) {
    case 'top':
      // Position text in upper safe area
      startY = safeTopMargin;
      break;
    case 'bottom':
      // Position text in lower safe area
      startY = canvasH - safeBottomMargin - totalTextHeight;
      break;
    case 'middle':
    case 'center':
    default:
      // Center vertically within the safe area
      startY = (canvasH - totalTextHeight) / 2;
      break;
  }
  
  // Ensure startY is within safe bounds
  startY = Math.max(safeTopMargin, Math.min(startY, canvasH - safeBottomMargin - totalTextHeight));
  
  // Track actual bounds for trimming
  let minX = canvasW, minY = canvasH, maxX = 0, maxY = 0;
  const baselines = [];

  // Render each line
  lines.forEach((line, index) => {
    const y = Math.round(startY + index * (finalFontPx + lineSpacingPx));
    baselines.push(y);
    
    // Calculate X position based on alignment
    let x;
    const lineMetrics = ctx.measureText(line);
    switch (align) {
      case 'left':
        x = boxXPx;
        break;
      case 'right':
        x = boxXPx + boxWPx - lineMetrics.width;
        break;
      case 'center':
      default:
        x = boxXPx + (boxWPx - lineMetrics.width) / 2;
        break;
    }
    
    x = Math.round(x);

    // Update bounds
    minX = Math.min(minX, x - strokePx - Math.abs(shadowX));
    minY = Math.min(minY, y - strokePx - Math.abs(shadowY));
    maxX = Math.max(maxX, x + lineMetrics.width + strokePx + Math.abs(shadowX));
    maxY = Math.max(maxY, y + finalFontPx + strokePx + Math.abs(shadowY));

    // Render shadow (if enabled)
    if (shadowBlur > 0 || shadowX !== 0 || shadowY !== 0) {
      ctx.save();
      ctx.globalAlpha = textAlpha;
      ctx.fillStyle = shadowColor;
      ctx.shadowColor = shadowColor;
      ctx.shadowBlur = shadowBlur;
      ctx.shadowOffsetX = shadowX;
      ctx.shadowOffsetY = shadowY;
      ctx.fillText(line, x, y);
      ctx.restore();
    }

    // Render stroke (if enabled)
    if (strokePx > 0) {
      ctx.save();
      ctx.globalAlpha = textAlpha;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokePx;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeText(line, x, y);
      ctx.restore();
    }

    // Render fill text
    ctx.save();
    ctx.globalAlpha = textAlpha;
    ctx.fillStyle = fill;
    ctx.fillText(line, x, y);
    ctx.restore();
  });

  // Ensure bounds are valid and within canvas
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(canvasW, Math.ceil(maxX));
  maxY = Math.min(canvasH, Math.ceil(maxY));
  
  // Ensure text doesn't render off-canvas
  if (minY >= canvasH || maxY <= 0 || minX >= canvasW || maxX <= 0) {
    console.warn(`[caption] Text bounds are off-canvas: minY=${minY}, maxY=${maxY}, canvasH=${canvasH}`);
    // Clamp to canvas bounds
    minY = Math.max(0, Math.min(minY, canvasH - 50)); // Leave 50px padding
    maxY = Math.min(canvasH, Math.max(maxY, 50)); // Leave 50px padding
  }

  const trimmedWidth = maxX - minX;
  const trimmedHeight = maxY - minY;

  if (trimmedWidth <= 0 || trimmedHeight <= 0) {
    throw new Error('Rendered text has no visible content');
  }

  // Create temp directory and file path
  const tmpDir = path.join(os.tmpdir(), 'shorts', jobId);
  await fs.promises.mkdir(tmpDir, { recursive: true });
  const pngPath = path.join(tmpDir, 'caption.png');

  // Save the full canvas as PNG
  const buffer = canvas.toBuffer('image/png');
  await fs.promises.writeFile(pngPath, buffer);

  console.log(`[caption] lines=${lines.length} fontPx=${finalFontPx} bbox={x:${minX},y:${minY},w:${trimmedWidth},h:${trimmedHeight}}`);

  // Compute yPct for proper vertical positioning based on placement
  // The minY represents where the text actually starts, but we need to compute
  // the center point of the text block for proper placement
  const textCenterY = minY + (trimmedHeight / 2);
  const yPct = textCenterY / canvasH;
  
  // Track actual font family used (for fallback detection)
  const fontFamilyUsed = fontRegistered ? 'DejaVu-Bold' : 'Arial';
  
  return {
    pngPath,
    publicUrl: null, // Will be set by the caller if uploaded
    xPx: minX,
    yPx: minY,
    wPx: trimmedWidth,
    hPx: trimmedHeight,
    meta: {
      splitLines: lines, // Use lines as expected by the system
      baselines,
      fontPx: finalFontPx,
      lineSpacingPx: lineSpacingPx,
      yPct: yPct, // Add computed yPct for proper positioning
      totalTextH: trimmedHeight, // Total text height for scaling
      fontFamilyUsed: fontFamilyUsed, // Track actual font used
    },
  };
}

export default { renderCaptionImage };
