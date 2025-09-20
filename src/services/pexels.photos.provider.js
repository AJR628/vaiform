const PEXELS_PHOTOS = "https://api.pexels.com/v1/search";

// Prefer vertical "portrait" src for 9:16
function pickSrc(photo) {
  const src = photo?.src || {};
  return src.portrait || src.large2x || src.large || src.original || src.medium || null;
}

const mem = new Map(); // key -> { at, ttl, items }

export async function pexelsSearchPhotos({ query, perPage = 12, page = 1 }) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return { ok: false, reason: "NOT_CONFIGURED", items: [] };

  const cacheKey = `photos|${query}|${perPage}|${page}`;
  const now = Date.now();
  const entry = mem.get(cacheKey);
  if (entry && now - entry.at < entry.ttl) return { ok: true, reason: "CACHE", items: entry.items };

  const url = new URL(PEXELS_PHOTOS);
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("orientation", "portrait");
  url.searchParams.set("page", String(Math.max(1, page)));

  const res = await fetch(url, { headers: { "Authorization": key, "Accept": "application/json" } });
  if (!res.ok) {
    // short negative cache on backoff
    mem.set(cacheKey, { at: now, ttl: 60_000, items: [] });
    return { ok: false, reason: `HTTP_${res.status}`, items: [] };
  }

  const data = await res.json();
  const items = [];
  for (const p of data?.photos || []) {
    const fileUrl = pickSrc(p);
    if (!fileUrl?.startsWith("https://")) continue;
    items.push({
      id: `pexels-photo-${p.id}`,
      provider: "pexels",
      query,
      fileUrl,
      width: p?.width || null,
      height: p?.height || null,
      photographer: p?.photographer || null,
      sourceUrl: p?.url || null,
      thumbUrl: p?.src?.medium || p?.src?.small || null,
    });
  }
  mem.set(cacheKey, { at: now, ttl: 12 * 60 * 60 * 1000, items });
  const nextPage = (data?.page && data?.per_page && data?.total_results)
    ? (data.page * data.per_page < data.total_results ? data.page + 1 : null)
    : null;
  return { ok: true, reason: "OK", items, nextPage };
}

export default { pexelsSearchPhotos };


