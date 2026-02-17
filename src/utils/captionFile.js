import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Write caption text to a temporary file for safe use with FFmpeg drawtext textfile=
 * @param {string} text - The caption text to write
 * @returns {string} - Path to the created caption file
 */
export function writeCaptionFile(text) {
  // drawtext treats '\n' literally when escape=1 (default), so keep backslashes out.
  const safe = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaiform-caption-'));
  const file = path.join(dir, 'caption.txt');
  fs.writeFileSync(file, safe, 'utf8');
  console.log('[captionFile] Created:', file, 'bytes:', fs.statSync(file).size);
  return file;
}
