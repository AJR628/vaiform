import admin from "../config/firebase.js";

export async function loadJSON({ uid, studioId, file = "session.json" }) {
  const bucket = admin.storage().bucket();
  const path = `drafts/${uid}/${studioId}/${file}`;
  const f = bucket.file(path);
  try {
    const [buf] = await f.download();
    return JSON.parse(buf.toString("utf8"));
  } catch (e) {
    if (e?.code === 404 || e?.code === 2) return null;
    throw e;
  }
}

export async function saveJSON({ uid, studioId, file = "session.json", data }) {
  const bucket = admin.storage().bucket();
  const path = `drafts/${uid}/${studioId}/${file}`;
  const f = bucket.file(path);
  const json = JSON.stringify(data);
  const sizeBytes = Buffer.byteLength(json, 'utf8');
  const MAX_SESSION_BYTES = 500 * 1024; // 500KB
  if (sizeBytes > MAX_SESSION_BYTES) {
    const err = new Error('SESSION_TOO_LARGE');
    err.code = 'SESSION_TOO_LARGE';
    err.sizeBytes = sizeBytes;
    err.maxBytes = MAX_SESSION_BYTES;
    throw err;
  }
  const buf = Buffer.from(json, 'utf8');
  await f.save(buf, {
    contentType: "application/json",
    resumable: false,
    validation: false,
    metadata: { cacheControl: "no-store" },
  });
  return { path };
}

export default { loadJSON, saveJSON };


