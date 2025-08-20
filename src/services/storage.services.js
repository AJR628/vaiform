// src/services/storage.service.js
import admin from 'firebase-admin';
import crypto from 'node:crypto';

export async function saveImageFromUrl(uid, jobId, srcUrl, { index = 0, contentType = 'image/webp' } = {}) {
  if (!uid) throw new Error('SAVE_IMAGE_MISSING_UID');
  if (!jobId) throw new Error('SAVE_IMAGE_MISSING_JOB');
  if (!srcUrl) throw new Error('SAVE_IMAGE_MISSING_SRC');

  const bucket = admin.storage().bucket();
  const objectPath = `artifacts/${uid}/${jobId}/image_${index}.webp`;
  const file = bucket.file(objectPath);

  const res = await fetch(srcUrl);
  if (!res.ok) throw new Error(`FETCH_FAIL_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const token = crypto.randomUUID();
  await file.save(buf, {
    contentType,
    metadata: {
      cacheControl: 'public,max-age=31536000,immutable',
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });

  const encoded = encodeURIComponent(objectPath);
  const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media&token=${token}`;
  return { objectPath, publicUrl };
}
