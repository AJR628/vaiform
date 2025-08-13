// src/services/storage.service.js
import { v4 as uuidv4 } from 'uuid';
import { bucket } from '../config/firebase.js';

// Lazy-load sharp so the app can still run if it isn't installed
let _sharpPromise;
async function getSharp() {
  if (!_sharpPromise) {
    _sharpPromise = import('sharp')
      .then((m) => m.default)
      .catch((err) => {
        console.warn('⚠️ sharp unavailable, skipping image optimization:', err?.message || err);
        return null; // allow app to keep running
      });
  }
  return _sharpPromise;
}

// Recompress/resize before saving to Firebase (default WebP; configurable)
export async function uploadToFirebaseStorage(imageUrl, email, index, opts = {}) {
  const {
    maxSide = 1536,
    quality = 85,
    contentType = 'image/webp', // "image/webp" | "image/jpeg" | "image/png"
    filenamePrefix = 'image',
  } = opts;

  try {
    // Use built-in fetch (Node 18+)
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to fetch image ${index}: ${response.status}`);
    const src = Buffer.from(await response.arrayBuffer());

    // Try to optimize with sharp; if not available, save original buffer
    const sharp = await getSharp();
    let optimized = src;

    if (sharp) {
      let pipeline = sharp(src).resize({
        width: maxSide,
        height: maxSide,
        fit: 'inside',
        withoutEnlargement: true,
      });

      if (contentType === 'image/jpeg' || contentType === 'image/jpg') {
        pipeline = pipeline.jpeg({ quality, mozjpeg: true });
      } else if (contentType === 'image/png') {
        pipeline = pipeline.png(); // PNG is lossless; quality ignored
      } else {
        // default to webp
        pipeline = pipeline.webp({ quality });
      }

      optimized = await pipeline.toBuffer();
    }

    const safeEmail = String(email || 'unknown').replace(/\W/g, '_');
    const ext =
      contentType === 'image/jpeg' || contentType === 'image/jpg'
        ? 'jpg'
        : contentType === 'image/png'
          ? 'png'
          : 'webp';
    const filename = `${filenamePrefix}-${Date.now()}-${uuidv4()}.${ext}`;
    const storagePath = `userUploads/${safeEmail}/${filename}`;
    const file = bucket.file(storagePath);

    // Save; if your bucket requires it, you may need file.makePublic()
    await file.save(optimized, {
      metadata: { contentType },
      public: true, // harmless if your bucket ignores it
    });

    // Public URL (works if object is public or you have appropriate rules)
    return `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(storagePath)}`;
  } catch (err) {
    console.error('❌ uploadToFirebaseStorage error:', err?.message || err);
    return null;
  }
}

// Normalize Replicate outputs → array of URLs
export function extractUrlsFromReplicateOutput(output) {
  if (Array.isArray(output)) return output.filter(Boolean);
  if (typeof output === 'string') return [output];
  if (output && typeof output === 'object') {
    if (typeof output.url === 'function') return [output.url()];
    if (typeof output.url === 'string') return [output.url];
    if (Array.isArray(output.images)) return output.images.filter(Boolean);
  }
  return [];
}
