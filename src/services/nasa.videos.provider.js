const NASA_SEARCH = "https://images-api.nasa.gov/search";
const NASA_ASSET = "https://images-api.nasa.gov/asset";

const mem = new Map();

/**
 * Search NASA videos
 * Requires NASA_API_KEY environment variable
 * @param {Object} params
 * @param {string} params.query - Search query
 * @param {number} params.perPage - Results per page (default 12)
 * @param {number} params.page - Page number (default 1)
 * @returns {Promise<{ok: boolean, reason: string, items: Array, nextPage: number|null}>}
 */
export async function nasaSearchVideos({ query, perPage = 12, page = 1 }) {
  const key = process.env.NASA_API_KEY;
  if (!key) {
    // Silent failure - return empty array, no error
    return { ok: false, reason: "NOT_CONFIGURED", items: [] };
  }

  const cacheKey = `nasa:videos|${query}|${perPage}|${page}`;
  const now = Date.now();
  const entry = mem.get(cacheKey);
  if (entry && now - entry.at < entry.ttl) {
    return { ok: true, reason: "CACHE", items: entry.items };
  }

  // Truncate query to 100 chars to be safe
  const normalizedQuery = String(query || '').trim().substring(0, 100);

  const url = new URL(NASA_SEARCH);
  url.searchParams.set("q", encodeURIComponent(normalizedQuery));
  url.searchParams.set("media_type", "video");
  url.searchParams.set("page", String(Math.max(1, page)));

  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" }
    });

    if (!res.ok) {
      // Log warning but don't throw
      const errorText = await res.text().catch(() => '');
      console.warn(`[nasa] HTTP ${res.status} error:`, errorText.substring(0, 200));
      
      // Short negative cache on error
      mem.set(cacheKey, { at: now, ttl: 60_000, items: [] });
      return { ok: false, reason: `HTTP_${res.status}`, items: [] };
    }

    const data = await res.json();
    const items = [];

    // Process each item in the collection
    for (const item of data?.collection?.items || []) {
      try {
        const nasaId = item?.data?.[0]?.nasa_id;
        if (!nasaId) continue;

        // Make secondary API call to get asset details
        const assetUrl = `${NASA_ASSET}/${nasaId}`;
        const assetRes = await fetch(assetUrl, {
          headers: { "Accept": "application/json" }
        });

        if (!assetRes.ok) {
          console.warn(`[nasa] Asset ${nasaId} HTTP ${assetRes.status}, skipping`);
          continue;
        }

        const assetData = await assetRes.json();
        
        // Find first .mp4 URL in the asset collection
        let mp4Url = null;
        const collection = assetData?.collection?.items || [];
        for (const assetItem of collection) {
          const href = assetItem?.href;
          if (href && typeof href === 'string' && href.toLowerCase().endsWith('.mp4')) {
            mp4Url = href;
            break;
          }
        }

        // Skip if no .mp4 found
        if (!mp4Url) {
          continue;
        }

        const dataItem = item.data[0];
        items.push({
          id: `nasa-video-${nasaId}`,
          provider: "nasa",
          providerId: nasaId,
          query: normalizedQuery,
          url: mp4Url,
          fileUrl: mp4Url, // Alias for compatibility
          thumbUrl: item.links?.[0]?.href || null,
          duration: 0, // NASA duration not reliably present
          width: null,
          height: null,
          photographer: dataItem?.photographer || dataItem?.center || 'NASA',
          sourceUrl: item.href || null,
          license: "nasa-public-domain"
        });
      } catch (itemError) {
        console.warn(`[nasa] Error processing item:`, itemError?.message || String(itemError));
        // Continue with next item
        continue;
      }
    }

    // Cache for 24 hours
    mem.set(cacheKey, { at: now, ttl: 24 * 60 * 60 * 1000, items });

    // Calculate nextPage if available
    const totalHits = data?.collection?.metadata?.total_hits || 0;
    const currentPage = page;
    const hitsPerPage = perPage;
    const nextPage = (currentPage * hitsPerPage < totalHits) ? currentPage + 1 : null;

    return { ok: true, reason: "OK", items, nextPage };
  } catch (error) {
    // Log error but don't throw - return empty array
    console.warn('[nasa] Search error:', error?.message || String(error));
    mem.set(cacheKey, { at: now, ttl: 60_000, items: [] });
    return { ok: false, reason: "ERROR", items: [] };
  }
}

export default { nasaSearchVideos };

