import fetch from "node-fetch";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { bucket } from "../config/firebase.js";

// Recompress/resize before saving to Firebase (WebP, tune per call)
export async function uploadToFirebaseStorage(imageUrl, email, index, opts = {}) {
  const {
    maxSide = 1536,
    quality = 85,
    contentType = "image/webp",
    filenamePrefix = "image",
  } = opts;

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to fetch image ${index}`);
    const src = Buffer.from(await response.arrayBuffer());

    const optimized = await sharp(src)
      .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();

    const safeEmail = email.replace(/\W/g, "_");
    const filename = `${filenamePrefix}-${Date.now()}-${uuidv4()}.webp`;
    const storagePath = `userUploads/${safeEmail}/${filename}`;
    const file = bucket.file(storagePath);

    await file.save(optimized, { metadata: { contentType }, public: true });

    return `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(storagePath)}`;
  } catch (err) {
    console.error("❌ uploadToFirebaseStorage error:", err.message);
    return null;
  }
}

// Normalize Replicate outputs → array of URLs
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