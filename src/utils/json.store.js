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
  const buf = Buffer.from(JSON.stringify(data, null, 2), "utf8");
  await f.save(buf, {
    contentType: "application/json",
    resumable: false,
    validation: false,
    metadata: { cacheControl: "no-store" },
  });
  return { path };
}

export default { loadJSON, saveJSON };


