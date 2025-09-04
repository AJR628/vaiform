import admin from "../config/firebase.js";
import crypto from "node:crypto";

/**
 * Upload a local file path to Firebase Storage and make it public via token URL.
 * Returns { publicUrl, gsPath }.
 */
export async function uploadPublic(localPath, destPath, contentType = "video/mp4") {
  const bucket = admin.storage().bucket();
  const file = bucket.file(destPath);
  const token = crypto.randomUUID();

  await bucket.upload(localPath, {
    destination: destPath,
    metadata: {
      contentType,
      cacheControl: "public,max-age=31536000,immutable",
      metadata: { firebaseStorageDownloadTokens: token },
    },
    resumable: false,
    validation: false,
  });

  const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(destPath)}?alt=media&token=${token}`;
  const gsPath = `gs://${bucket.name}/${destPath}`;
  return { publicUrl, gsPath };
}

export default { uploadPublic };


