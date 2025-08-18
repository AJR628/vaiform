// src/adapters/realesrgan.adapter.js
const API_BASE = "https://api.replicate.com/v1";
const OWNER = "nightmareai";
const MODEL = "real-esrgan";

async function httpJson(url, opts = {}) {
  const resp = await fetch(url, opts);
  const text = await resp.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!resp.ok) {
    const detail = json ? JSON.stringify(json) : text;
    const err = new Error(`Request to ${url} failed ${resp.status} ${resp.statusText}: ${detail}`);
    err.status = resp.status; err.detail = detail;
    throw err;
  }
  return json;
}

let cachedVersion; // memoize for this process
async function getLatestVersion() {
  if (cachedVersion) return cachedVersion;
  const res = await httpJson(`${API_BASE}/models/${OWNER}/${MODEL}/versions`, {
    headers: {
      "Authorization": `Token ${process.env.REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
    }
  });
  const latest = Array.isArray(res?.results) ? res.results[0] : null;
  if (!latest?.id) throw new Error(`Could not find latest version for ${OWNER}/${MODEL}`);
  cachedVersion = latest.id;
  return cachedVersion;
}

export default {
  name: "realesrgan",
  /**
   * invoke({ refs:[imageUrl], upscale?: 2|3|4, face_enhance?: boolean })
   * -> { predictionUrl }
   */
  async invoke({ refs = [], upscale = 2, face_enhance = false } = {}) {
    if (!process.env.REPLICATE_API_TOKEN) throw new Error("Missing REPLICATE_API_TOKEN");
    if (!Array.isArray(refs) || !refs[0]) throw new Error("realesrgan.invoke requires refs:[imageUrl]");

    const version = await getLatestVersion();
    const input = {
      image: refs[0],                 // 👈 nightmareai uses `image`
      scale: Number(upscale) || 2,    // 2, 3, or 4
      face_enhance: !!face_enhance,   // optional
    };

    const pred = await httpJson(`${API_BASE}/predictions`, {
      method: "POST",
      headers: {
        "Authorization": `Token ${process.env.REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ version, input }),
    });

    const predictionUrl = pred?.urls?.get || pred?.urls?.self;
    if (!predictionUrl) throw new Error("No prediction URL returned from Replicate");
    return { predictionUrl };
  },
};