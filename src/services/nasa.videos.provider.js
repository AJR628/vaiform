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
  console.log(`[nasa] nasaSearchVideos called: query="${query}", perPage=${perPage}, page=${page}`);
  const key = process.env.NASA_API_KEY;
  console.log(`[nasa] API key present: ${!!key}`);
  if (!key) {
    // Silent failure - return empty array, no error
    const result = { ok: false, reason: "NOT_CONFIGURED", items: [] };
    console.log(`[nasa] Returning: ok=${result.ok}, reason="${result.reason}", items.length=${result.items.length}`);
    return result;
  }

  const cacheKey = `nasa:videos|${query}|${perPage}|${page}`;
  const now = Date.now();
  const entry = mem.get(cacheKey);
  if (entry && now - entry.at < entry.ttl) {
    const result = { ok: true, reason: "CACHE", items: entry.items };
    console.log(`[nasa] Returning: ok=${result.ok}, reason="${result.reason}", items.length=${result.items.length}`);
    return result;
  }

  // Truncate query to 100 chars to be safe
  const normalizedQuery = String(query || '').trim().substring(0, 100);
  const targetCount = perPage || 12;

  const url = new URL(NASA_SEARCH);
  url.searchParams.set("q", encodeURIComponent(normalizedQuery));
  url.searchParams.set("media_type", "video");
  url.searchParams.set("page", String(Math.max(1, page)));
  url.searchParams.set("page_size", "30");

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
      const result = { ok: false, reason: `HTTP_${res.status}`, items: [] };
      console.log(`[nasa] Returning: ok=${result.ok}, reason="${result.reason}", items.length=${result.items.length}`);
      return result;
    }

    const data = await res.json();
    const rawItemsCount = data?.collection?.items?.length || 0;
    const totalHits = data?.collection?.metadata?.total_hits || 0;
    console.log(`[nasa] raw search: status=${res.status}, total_items=${rawItemsCount}, total_hits=${totalHits}, media_type_filter=video`);
    const items = [];
    let processedCount = 0;

    // Process each item in the collection
    for (const item of data?.collection?.items || []) {
      processedCount++;
      try {
        const nasaId = item?.data?.[0]?.nasa_id;
        const mediaType = item?.data?.[0]?.media_type;
        if (!nasaId) {
          console.log(`[nasa] drop: no nasa_id (media_type=${mediaType || 'N/A'})`);
          continue;
        }

        // Make secondary API call to get asset details
        const assetUrl = `${NASA_ASSET}/${nasaId}`;
        const assetRes = await fetch(assetUrl, {
          headers: { "Accept": "application/json" }
        });

        if (!assetRes.ok) {
          console.warn(`[nasa] drop: asset fetch failed for ${nasaId} (HTTP ${assetRes.status})`);
          continue;
        }

        const assetData = await assetRes.json();
        
        // Find first .mp4 URL in the asset collection
        let mp4Url = null;
        const collection = assetData?.collection?.items || [];
        console.log(`[nasa] checking asset collection for mp4 (${collection.length} items) for nasa_id=${nasaId}`);
        for (const assetItem of collection) {
          const href = assetItem?.href;
          if (href && typeof href === 'string' && href.toLowerCase().endsWith('.mp4')) {
            mp4Url = href;
            break;
          }
        }

        // Skip if no .mp4 found
        if (!mp4Url) {
          const sampleHrefs = collection.slice(0, 3).map(item => item?.href?.substring(0, 60) || 'N/A').join(', ');
          console.log(`[nasa] drop: no mp4 found in asset list (checked ${collection.length} items, sample hrefs: ${sampleHrefs}...)`);
          continue;
        }

        const dataItem = item.data[0];
        const title = dataItem?.title?.substring(0, 50) || 'N/A';
        const urlPreview = mp4Url.substring(0, 80);
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
        console.log(`[nasa] keep: nasa_id=${nasaId}, title="${title}", url=${urlPreview}...`);
        
        // Early exit if we have enough normalized items
        if (items.length >= targetCount) {
          break;
        }
      } catch (itemError) {
        console.warn(`[nasa] Error processing item:`, itemError?.message || String(itemError));
        // Continue with next item
        continue;
      }
    }

    console.log(`[nasa] processed ${processedCount} raw items, returned ${items.length} normalized items (target was ${targetCount})`);

    // Cache for 24 hours
    mem.set(cacheKey, { at: now, ttl: 24 * 60 * 60 * 1000, items });

    // Calculate nextPage if available
    const currentPage = page;
    const hitsPerPage = perPage;
    const nextPage = (currentPage * hitsPerPage < totalHits) ? currentPage + 1 : null;

    console.log(`[nasa] final normalized items.length=${items.length} (from ${rawItemsCount} raw items)`);
    const result = { ok: true, reason: "OK", items, nextPage };
    console.log(`[nasa] Returning: ok=${result.ok}, reason="${result.reason}", items.length=${result.items.length}`);
    return result;
  } catch (error) {
    // Log error but don't throw - return empty array
    console.warn('[nasa] Search error:', error?.message || String(error));
    mem.set(cacheKey, { at: now, ttl: 60_000, items: [] });
    const result = { ok: false, reason: "ERROR", items: [] };
    console.log(`[nasa] Returning: ok=${result.ok}, reason="${result.reason}", items.length=${result.items.length}`);
    return result;
  }
}

export default { nasaSearchVideos };

