/**
 * Temporary file utilities for SSOT v3 rasterized overlays
 * 
 * Handles downloading and caching raster PNGs from various sources (http, data URLs, Firebase Storage)
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

/**
 * Fetch a URL (http/https/gs://data:) to a temporary file
 * @param {string} url - URL to fetch (http, https, data:, or gs://)
 * @param {string} ext - File extension (default: '.png')
 * @returns {Promise<string>} Path to temporary file
 */
export async function fetchToTmp(url, ext = '.png') {
  if (!url || typeof url !== 'string') {
    throw new Error('Invalid URL provided to fetchToTmp');
  }

  // Handle data URLs
  if (url.startsWith('data:')) {
    return await dataUrlToTmp(url, ext);
  }

  // Handle http/https URLs
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return await httpToTmp(url, ext);
  }

  // Handle Firebase Storage gs:// URLs (convert to https)
  if (url.startsWith('gs://')) {
    // Convert gs://bucket/path to https://storage.googleapis.com/bucket/path
    const gsPath = url.replace(/^gs:\/\/([^/]+)\/(.+)$/, 'https://storage.googleapis.com/$1/$2');
    return await httpToTmp(gsPath, ext);
  }

  throw new Error(`Unsupported URL scheme: ${url.substring(0, 20)}...`);
}

/**
 * Convert a data URL to a temporary file
 * @param {string} dataUrl - Data URL (data:image/png;base64,...)
 * @param {string} ext - File extension
 * @returns {Promise<string>} Path to temporary file
 */
async function dataUrlToTmp(dataUrl, ext = '.png') {
  const match = /^data:(.+?);base64,(.*)$/.exec(dataUrl);
  if (!match) {
    throw new Error('Invalid data URL format');
  }

  const [, mime, b64] = match;
  const buffer = Buffer.from(b64, 'base64');

  // Auto-detect extension from MIME type if not provided
  if (!ext || ext === '.png') {
    if (mime.includes('jpeg') || mime.includes('jpg')) ext = '.jpg';
    else if (mime.includes('png')) ext = '.png';
    else if (mime.includes('webp')) ext = '.webp';
  }

  const tmpPath = getTmpPath(ext);
  await fsp.writeFile(tmpPath, buffer);

  console.log(`[tmp] Wrote data URL to ${tmpPath} (${buffer.length} bytes)`);
  return tmpPath;
}

/**
 * Download an HTTP/HTTPS URL to a temporary file
 * @param {string} url - HTTP/HTTPS URL
 * @param {string} ext - File extension
 * @returns {Promise<string>} Path to temporary file
 */
async function httpToTmp(url, ext = '.png') {
  const https = await import('https');
  const http = await import('http');

  return new Promise((resolve, reject) => {
    const tmpPath = getTmpPath(ext);
    const writeStream = fs.createWriteStream(tmpPath);
    const client = url.startsWith('https') ? https : http;

    client.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} fetching ${url}`));
        return;
      }

      response.pipe(writeStream);

      writeStream.on('finish', () => {
        writeStream.close();
        const stats = fs.statSync(tmpPath);
        console.log(`[tmp] Downloaded ${url} to ${tmpPath} (${stats.size} bytes)`);
        resolve(tmpPath);
      });

      writeStream.on('error', (err) => {
        fs.unlinkSync(tmpPath);
        reject(err);
      });
    }).on('error', reject);
  });
}

/**
 * Generate a temporary file path
 * @param {string} ext - File extension (e.g., '.png')
 * @returns {string} Temporary file path
 */
function getTmpPath(ext = '.png') {
  const uuid = randomUUID();
  const tmpDir = os.tmpdir();
  return path.join(tmpDir, `vaiform-${uuid}${ext}`);
}

/**
 * Clean up a temporary file
 * @param {string} filePath - Path to temporary file
 * @returns {Promise<void>}
 */
export async function cleanupTmp(filePath) {
  if (!filePath || typeof filePath !== 'string') return;

  try {
    if (fs.existsSync(filePath)) {
      await fsp.unlink(filePath);
      console.log(`[tmp] Cleaned up ${filePath}`);
    }
  } catch (err) {
    console.warn(`[tmp] Failed to clean up ${filePath}:`, err.message);
  }
}

/**
 * Save a buffer to a temporary file
 * @param {Buffer} buffer - Buffer to save
 * @param {string} ext - File extension
 * @returns {Promise<string>} Path to temporary file
 */
export async function bufferToTmp(buffer, ext = '.png') {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('Invalid buffer provided to bufferToTmp');
  }

  const tmpPath = getTmpPath(ext);
  await fsp.writeFile(tmpPath, buffer);

  console.log(`[tmp] Wrote buffer to ${tmpPath} (${buffer.length} bytes)`);
  return tmpPath;
}

