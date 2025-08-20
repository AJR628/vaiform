// src/services/storage.service.js
import admin from "firebase-admin";
import crypto from "node:crypto";

/* ---------- optional: lazy-load sharp for recompress ---------- */
let _sharpPromise;
async function getSharp() {
  if (!_sharpPromise) {
    _sharpPromise = import("sharp")
      .then((m) => m.default)
      .catch((err) => {
        console.warn("⚠️ sharp unavailable, skipping recompress:", err?.message || err);
        return null;
      });
  }
  return _sharpPromise;
}

/* ---------- helpers ---------- */
function extFromContentType(ct) {
  const c = (ct || "").toLowerCase();
  if (c.includes("image/webp")) return { ext: "webp", ct: "image/webp" };
  if (c.includes("image/png"))  return { ext: "png",  ct: "image/png" };
  if (c.includes("image/jpeg")) return { ext: "jpg",  ct: "image/jpeg" };
  return { ext: "bin", ct: c || "application/octet-stream" };
}

function publicTokenUrl(bucketName, objectPath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

/* ---------- primary Gate C API ---------- */
/**
 * Fetch a remote URL and persist under artifacts/{uid}/{jobId}/image_{index}.{ext}
 * If { recompress:true } and sharp is available, we write WebP.
 */
export async function saveImageFromUrl(
  uid,
  jobId,
  srcUrl,
  { index = 0, recompress = false, maxSide = 1536, webpQuality = 85 } = {}
) {
  if (!uid) throw new Error("SAVE_IMAGE_MISSING_UID");
  if (!jobId) throw new Error("SAVE_IMAGE_MISSING_JOB");
  if (!srcUrl) throw new Error("SAVE_IMAGE_MISSING_SRC");

  const bucket = admin.storage().bucket();

  // 15s timeout on fetch
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 15000);
  let res;
  try {
    res = await fetch(srcUrl, { signal: ac.signal });
  } finally {
    clearTimeout(to);
  }
  if (!res.ok) throw new Error(`FETCH_FAIL_${res.status}`);

  const srcBuf = Buffer.from(await res.arrayBuffer());
  let outBuf = srcBuf;
  let { ext, ct } = extFromContentType(res.headers.get("content-type"));

  if (recompress) {
    const sharp = await getSharp();
    if (sharp) {
      outBuf = await sharp(srcBuf)
        .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
        .webp({ quality: webpQuality })
        .toBuffer();
      ext = "webp";
      ct  = "image/webp";
    }
  }

  const objectPath = `artifacts/${uid}/${jobId}/image_${index}.${ext}`;
  const file = bucket.file(objectPath);
  const token = crypto.randomUUID();

  await file.save(outBuf, {
    contentType: ct,
    metadata: {
      cacheControl: "public,max-age=31536000,immutable",
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });

  return { objectPath, publicUrl: publicTokenUrl(bucket.name, objectPath, token), contentType: ct };
}

/**
 * Save a raw buffer as artifacts/{uid}/{jobId}/image_{index}.webp (or provided type)
 */
export async function saveImageBuffer(uid, jobId, buffer, { index = 0, contentType = "image/webp" } = {}) {
  if (!uid) throw new Error("SAVE_IMAGE_MISSING_UID");
  if (!jobId) throw new Error("SAVE_IMAGE_MISSING_JOB");
  if (!buffer) throw new Error("SAVE_IMAGE_MISSING_BUFFER");

  const bucket = admin.storage().bucket();
  const { ext, ct } = extFromContentType(contentType);
  const objectPath = `artifacts/${uid}/${jobId}/image_${index}.${ext}`;
  const file = bucket.file(objectPath);
  const token = crypto.randomUUID();

  await file.save(buffer, {
    contentType: ct,
    metadata: {
      cacheControl: "public,max-age=31536000,immutable",
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });

  return { objectPath, publicUrl: publicTokenUrl(bucket.name, objectPath, token), contentType: ct };
}

/* ---------- legacy helper kept for compat (DEPRECATED) ---------- */
/**
 * DEPRECATED: original email-keyed upload helper.
 * Kept to avoid breaking imports; now delegates to saveImageFromUrl when possible.
 */
export async function uploadToFirebaseStorage(imageUrl, email, index, opts = {}) {
  // Prefer the new path when uid/jobId are provided in opts:
  if (opts?.uid && opts?.jobId) {
    return (await saveImageFromUrl(opts.uid, opts.jobId, imageUrl, { index, recompress: opts.recompress }))
      ?.publicUrl ?? null;
  }
  console.warn("⚠️ uploadToFirebaseStorage is deprecated; provide {uid, jobId} in opts to use Gate C storage.");
  // Fallback: still write to artifacts with synthesized jobId
  const fakeJobId = `legacy-${Date.now()}`;
  return (await saveImageFromUrl(opts?.uid || "unknown", fakeJobId, imageUrl, { index, recompress: opts.recompress }))
    ?.publicUrl ?? null;
}

/* ---------- small utility you already had ---------- */
export function extractUrlsFromReplicateOutput(output) {
  if (Array.isArray(output)) return output.filter(Boolean);
  if (typeof output === "string") return [output];
  if (output && typeof output === "object") {
    if (typeof output.url === "function") return [output.url()];
    if (typeof output.url === "string") return [output.url];
    if (Array.isArray(output.images)) return output.images.filter(Boolean);
  }
  return [];
}