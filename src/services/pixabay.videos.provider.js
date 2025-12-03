const PIXABAY_VIDEOS = "https://pixabay.com/api/videos/";

const mem = new Map();

/**
 * Search Pixabay videos
 * Requires PIXABAY_API_KEY environment variable
 * @param {Object} params
 * @param {string} params.query - Search query
 * @param {number} params.perPage - Results per page (default 12)
 * @param {number} params.page - Page number (default 1)
 * @returns {Promise<{ok: boolean, reason: string, items: Array, nextPage: number|null}>}
 */
export async function pixabaySearchVideos({ query, perPage = 12, page = 1 }) {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) {
    // Silent failure - return empty array, no error
    return { ok: false, reason: "NOT_CONFIGURED", items: [] };
  }

  const cacheKey = `pixabay:videos|${query}|${perPage}|${page}`;
  const now = Date.now();
  const entry = mem.get(cacheKey);
  if (entry && now - entry.at < entry.ttl) {
    return { ok: true, reason: "CACHE", items: entry.items };
  }

  // Truncate query to 100 chars to be safe
  const normalizedQuery = String(query || '').trim().substring(0, 100);
  
  const url = new URL(PIXABAY_VIDEOS);
  url.searchParams.set("key", key);
  url.searchParams.set("q", encodeURIComponent(normalizedQuery));
  url.searchParams.set("safesearch", "true");
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("order", "popular");
  url.searchParams.set("page", String(Math.max(1, page)));

  try {
    const res = await fetch(url, { 
      headers: { "Accept": "application/json" } 
    });

    // Log rate limit headers if present
    const rateLimitLimit = res.headers.get("X-RateLimit-Limit");
    const rateLimitRemaining = res.headers.get("X-RateLimit-Remaining");
    const rateLimitReset = res.headers.get("X-RateLimit-Reset");
    if (rateLimitLimit || rateLimitRemaining || rateLimitReset) {
      console.log('[pixabay] Rate limit headers:', {
        limit: rateLimitLimit,
        remaining: rateLimitRemaining,
        reset: rateLimitReset
      });
    }

    if (!res.ok) {
      // Log warning but don't throw
      const errorText = await res.text().catch(() => '');
      console.warn(`[pixabay] HTTP ${res.status} error:`, errorText.substring(0, 200));
      
      // Short negative cache on error
      mem.set(cacheKey, { at: now, ttl: 60_000, items: [] });
      return { ok: false, reason: `HTTP_${res.status}`, items: [] };
    }

    const data = await res.json();
    const items = [];

    for (const hit of data?.hits || []) {
      // Choose video size: prefer medium, fallback to large, small, tiny
      const chosen = hit.videos?.medium || hit.videos?.large || hit.videos?.small || hit.videos?.tiny;
      if (!chosen || !chosen.url) continue;

      items.push({
        id: `pixabay-video-${hit.id}`,
        provider: "pixabay",
        providerId: hit.id,
        query: normalizedQuery,
        duration: hit.duration, // Pixabay returns seconds, same as Pexels
        width: chosen.width || 0,
        height: chosen.height || 0,
        url: chosen.url, // Direct mp4 URL
        fileUrl: chosen.url, // Alias for compatibility with Pexels format
        photographer: hit.user || null,
        sourceUrl: hit.pageURL || null,
        thumbUrl: chosen.thumbnail || null,
        license: "pixabay"
      });
    }

    // Cache for 24 hours (respecting Pixabay's 24h rule)
    mem.set(cacheKey, { at: now, ttl: 24 * 60 * 60 * 1000, items });

    // Calculate nextPage if available
    const totalHits = data?.totalHits || 0;
    const currentPage = data?.page || page;
    const hitsPerPage = data?.per_page || perPage;
    const nextPage = (currentPage * hitsPerPage < totalHits) ? currentPage + 1 : null;

    return { ok: true, reason: "OK", items, nextPage };
  } catch (error) {
    // Log error but don't throw - return empty array
    console.warn('[pixabay] Search error:', error?.message || String(error));
    mem.set(cacheKey, { at: now, ttl: 60_000, items: [] });
    return { ok: false, reason: "ERROR", items: [] };
  }
}

export default { pixabaySearchVideos };

