import admin from '../config/firebase.js';
import crypto from 'node:crypto';

/**
 * Upload a local file path to Firebase Storage and make it public via token URL.
 * Returns { publicUrl, gsPath }.
 */
export async function uploadPublic(localPath, destPath, contentType = 'video/mp4') {
  const bucket = admin.storage().bucket();
  const file = bucket.file(destPath);
  const token = crypto.randomUUID();

  const uploadPromise = bucket.upload(localPath, {
    destination: destPath,
    metadata: {
      contentType,
      cacheControl: 'public,max-age=31536000,immutable',
      metadata: { firebaseStorageDownloadTokens: token },
    },
    resumable: false,
    validation: false,
  });

  // Wrap upload in timeout wrapper (zombie uploads possible but acceptable per spec)
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('STORAGE_UPLOAD_TIMEOUT')), 60000)
  );

  try {
    await Promise.race([uploadPromise, timeoutPromise]);
  } catch (err) {
    // Note: If timeout fires, uploadPromise may continue in background (zombie upload)
    // This is acceptable per spec - request unblocks even if upload continues
    // Callers should not delete localPath file until uploadPromise settles (success or error)
    // However, for P0, we accept that zombie uploads may complete or fail independently
    if (err.message === 'STORAGE_UPLOAD_TIMEOUT') {
      throw err;
    }
    throw err;
  }

  const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(destPath)}?alt=media&token=${token}`;
  const gsPath = `gs://${bucket.name}/${destPath}`;
  return { publicUrl, gsPath };
}

// Build a public download URL for a given object path and optional token
export function buildPublicUrl({ bucket, path, token }) {
  const encodedPath = encodeURIComponent(path);
  const q = token ? `?alt=media&token=${encodeURIComponent(token)}` : `?alt=media`;
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}${q}`;
}

// Read Firebase download token from object metadata via Admin SDK
export async function getDownloadToken(file) {
  const [md] = await file.getMetadata();
  const raw = md.metadata?.firebaseStorageDownloadTokens || md.metadata?.downloadTokens || '';
  const token =
    String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)[0] || null;
  return token;
}

export default { uploadPublic, buildPublicUrl, getDownloadToken };
