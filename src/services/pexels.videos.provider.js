const PEXELS_VIDEOS = "https://api.pexels.com/videos/search";

function pickBestFile(video, { targetDur = 8 }) {
  const files = (video?.video_files || []).filter(f =>
    f?.link?.startsWith("https://") &&
    (f?.file_type === "video/mp4" || f?.file_type === "video/quicktime")
  );

  const score = (f) => {
    const w = f.width || 0, h = f.height || 0;
    const aspect = h ? w / h : 1;
    const aspectDelta = Math.abs(aspect - (9/16));
    const dur = video?.duration || targetDur;
    const durDelta = Math.abs(dur - targetDur);
    const sizePenalty = Math.max(0, 1080 - h) / 1080;
    return aspectDelta * 10 + durDelta * 0.5 + sizePenalty * 2;
  };

  let best = null, bestScore = Infinity;
  for (const f of files) {
    const s = score(f);
    if (s < bestScore) { best = f; bestScore = s; }
  }
  return best;
}

const mem = new Map();

export async function pexelsSearchVideos({ query, perPage = 10, targetDur = 8, page = 1 }) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return { ok: false, reason: "NOT_CONFIGURED", items: [] };

  const cacheKey = `videos|${query}|${perPage}|${targetDur}|${page}`;
  const now = Date.now();
  const entry = mem.get(cacheKey);
  if (entry && now - entry.at < entry.ttl) return { ok: true, reason: "CACHE", items: entry.items };

  const url = new URL(PEXELS_VIDEOS);
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("orientation", "portrait");
  url.searchParams.set("size", "large");
  url.searchParams.set("page", String(Math.max(1, page)));

  const res = await fetch(url, { headers: { "Authorization": key, "Accept": "application/json" } });
  if (!res.ok) {
    mem.set(cacheKey, { at: now, ttl: 60_000, items: [] });
    return { ok: false, reason: `HTTP_${res.status}`, items: [] };
  }

  const data = await res.json();
  const items = [];
  for (const v of data?.videos || []) {
    const best = pickBestFile(v, { targetDur });
    if (!best) continue;
    items.push({
      id: `pexels-video-${v.id}`,
      provider: "pexels",
      query,
      duration: v.duration,
      width: best.width,
      height: best.height,
      fileUrl: best.link,
      fileType: best.file_type,
      photographer: v?.user?.name || null,
      sourceUrl: v?.url || null,
      thumbUrl: v?.image || null,
    });
  }
  mem.set(cacheKey, { at: now, ttl: 12 * 60 * 60 * 1000, items });
  return { ok: true, reason: "OK", items };
}

export default { pexelsSearchVideos };


