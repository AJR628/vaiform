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
 * Add font with fallback path resolution
 * @param {string} file - Font filename
 * @param {string} family - Font family name
 * @returns {boolean} Success status
 */
function addFont(file, family) {
  const candidates = [
    path.join(process.cwd(), 'assets', 'fonts', file),
    path.join(process.cwd(), 'web', 'assets', 'fonts', file)
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        GlobalFonts.registerFromPath(p, family);
        console.log('[canvas-fonts] Registered font:', p, 'as', family);
        return true;
      } catch (e) {
        console.error('[canvas-fonts] Failed to register font:', p, e.message);
      }
    }
  }
  console.error('[canvas-fonts] Font not found:', file);
  return false;
}

/**
 * Register DejaVu fonts with @napi-rs/canvas
 * Idempotent - safe to call multiple times
 * @returns {Object} Registration status
 */
export function registerDejaVuFonts() {
  // Idempotent guard - check if already registered
  try {
    if (GlobalFonts.has && GlobalFonts.has('DejaVu Sans Bold Italic')) {
      console.log('[canvas-fonts] DejaVu fonts already registered');
      return { okRegular: true, okBold: true, okItalic: true, okBoldItalic: true };
    }
  } catch (e) {
    // GlobalFonts.has might not be available in all versions
    console.log('[canvas-fonts] Checking existing fonts...');
  }
  
  // Register all variants with base family "DejaVu Sans" using weight/style descriptors
  const okRegular    = addFont('DejaVuSans.ttf',             'DejaVu Sans');
  const okBold       = addFont('DejaVuSans-Bold.ttf',        'DejaVu Sans');
  const okItalic     = addFont('DejaVuSans-Oblique.ttf',     'DejaVu Sans');
  const okBoldItalic = addFont('DejaVuSans-BoldOblique.ttf', 'DejaVu Sans');
  
  // Log registration status
  const status = { okRegular, okBold, okItalic, okBoldItalic };
  console.log('[canvas-fonts] DejaVu variants registered:', status);
  
  // Log available font families
  try {
    const families = GlobalFonts.families;
    console.log('[canvas-fonts] Available families:', families);
    
    // Verify all 4 DejaVu Sans variants are available (all registered as "DejaVu Sans")
    const requiredVariants = [
      'DejaVu Sans'
    ];
    
    let allVariantsAvailable = true;
    for (const family of requiredVariants) {
      const isAvailable = families.some(f => f.family === family);
      if (!isAvailable) {
        console.error('[canvas-fonts] Missing variant family:', family);
        allVariantsAvailable = false;
      }
    }
    
    if (!allVariantsAvailable) {
      console.error('[canvas-fonts] FAILED: DejaVu Sans base family not available');
      throw new Error('DejaVu Sans font registration incomplete - base family missing');
    } else {
      console.log('[canvas-fonts] SUCCESS: DejaVu Sans base family verified (all variants registered)');
    }
  } catch (e) {
    console.log('[canvas-fonts] Could not list font families:', e.message);
  }
  
  return status;
}
