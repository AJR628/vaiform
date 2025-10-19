/**
 * DejaVu Font Registration for @napi-rs/canvas
 * 
 * Single-point, idempotent registration ensuring preview-render parity.
 * Resolves fonts from assets/fonts/ with robust path checking.
 */

import { GlobalFonts } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve font path with fallback locations
 * @param {string} filename - Font filename (e.g., 'DejaVuSans.ttf')
 * @returns {string|null} Absolute path to font file, or null if not found
 */
function resolveFontPath(filename) {
  const candidates = [
    path.resolve(process.cwd(), 'assets', 'fonts', filename),
    path.resolve(process.cwd(), 'src', 'assets', 'fonts', filename)
  ];
  
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  
  return null;
}

/**
 * Register DejaVu fonts with @napi-rs/canvas
 * Idempotent - safe to call multiple times
 * @returns {Object} Registration status
 */
export function registerDejaVuFonts() {
  // Idempotent guard - check if already registered
  try {
    if (GlobalFonts.has && GlobalFonts.has('DejaVu Sans')) {
      console.log('[canvas-fonts] DejaVu fonts already registered');
      return { okRegular: true, okBold: true };
    }
  } catch (e) {
    // GlobalFonts.has might not be available in all versions
    console.log('[canvas-fonts] Checking existing fonts...');
  }
  
  // Resolve font paths
  const regularPath = resolveFontPath('DejaVuSans.ttf');
  const boldPath = resolveFontPath('DejaVuSans-Bold.ttf');
  
  console.log('[canvas-fonts] regularPath:', regularPath);
  console.log('[canvas-fonts] boldPath:', boldPath);
  
  let okRegular = false;
  let okBold = false;
  
  // Register regular font
  if (regularPath) {
    try {
      GlobalFonts.registerFromPath(regularPath, 'DejaVu Sans');
      console.log('[canvas-fonts] Registered regular font:', regularPath);
      okRegular = true;
    } catch (e) {
      console.error('[canvas-fonts] Failed to register regular font:', e.message);
    }
  } else {
    console.error('[canvas-fonts] Regular font not found in any location');
  }
  
  // Register bold font
  if (boldPath) {
    try {
      GlobalFonts.registerFromPath(boldPath, 'DejaVu Sans');
      console.log('[canvas-fonts] Registered bold font:', boldPath);
      okBold = true;
    } catch (e) {
      console.error('[canvas-fonts] Failed to register bold font:', e.message);
    }
  } else {
    console.error('[canvas-fonts] Bold font not found in any location');
  }
  
  // Log registration status
  const status = { okRegular, okBold };
  console.log('[canvas-fonts] Registered fonts:', status);
  
  // Log available font families
  try {
    const families = GlobalFonts.families;
    console.log('[canvas-fonts] Available families:', families);
  } catch (e) {
    console.log('[canvas-fonts] Could not list font families:', e.message);
  }
  
  return status;
}
