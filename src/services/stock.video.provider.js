import { pexelsSearchVideos } from "./pexels.videos.provider.js";
import { createHash } from "node:crypto";

const CURATED = {
  calm: [
    // Add your own vertical loop mp4s if available
  ],
};

function stablePick(arr, key) {
  const b = createHash("sha1").update(key).digest()[0];
  return arr[b % arr.length];
}

export async function resolveStockVideo({ query, targetDur = 8, perPage = 10 }) {
  const q = (query || "calm").toLowerCase().trim();
  try {
    const r = await pexelsSearchVideos({ query: q, perPage, targetDur });
    if (r.ok && r.items.length) {
      const top = r.items.slice(0, 3).map(it => ({
        id: it.id,
        kind: "stockVideo",
        url: it.fileUrl,
        credit: { provider: "pexels", query: q, photographer: it.photographer, sourceUrl: it.sourceUrl },
        thumbUrl: it.thumbUrl || null,
      }));
      return { ok: true, items: top };
    }
  } catch (e) {
    console.warn("[stockVideo] pexels error:", e?.message || e);
  }

  const pool = CURATED[q] || [];
  if (pool.length) {
    const picks = new Set();
    picks.add(stablePick(pool, q + "|0"));
    if (pool.length > 1) picks.add(stablePick(pool, q + "|1"));
    if (pool.length > 2) picks.add(stablePick(pool, q + "|2"));
    const items = Array.from(picks).map((url, i) => ({
      id: `curated-${q}-${i}`,
      kind: "stockVideo",
      url,
      credit: { provider: "curated", query: q },
      thumbUrl: null,
    }));
    return { ok: true, items };
  }
  return { ok: false, items: [], reason: "NO_RESULTS" };
}

export default { resolveStockVideo };


