import { AssetsOptionsSchema, AiImagesSchema } from "../schemas/quotes.schema.js";
import { pexelsSearchVideos } from "../services/pexels.videos.provider.js";
import { pexelsSearchPhotos } from "../services/pexels.photos.provider.js";
import { generateAIImage } from "../services/ai.image.provider.js";

export async function getAssetsOptions(req, res) {
  try {
    const parsed = AssetsOptionsSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, reason: "BAD_REQUEST", detail: parsed.error.flatten() });
    }
    const { type, query = "calm", page = 1, perPage = 12 } = parsed.data;
    
    // Apply Free vs Pro limits
    const isPro = req.isPro || false;
    const maxPerPage = isPro ? 16 : 12; // allow fuller grid for free users too
    const actualPerPage = Math.min(perPage, maxPerPage);

    // Randomize starting page for variety when page===1
    const safeRand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const startPage = page === 1 ? safeRand(1, 10) : page; // bound within 1..10

    // Maintain seen IDs per session (by token/user)
    const sessKey = `assets_seen_${type}`;
    req.session = req.session || {};
    const seen = new Set(Array.isArray(req.session[sessKey]) ? req.session[sessKey] : []);

    let result = { items: [], nextPage: null };
    
    if (type === "images") {
      const response = await pexelsSearchPhotos({ query, perPage: actualPerPage, page: startPage });
      if (response.ok) {
        // Normalize + de-dupe by id across session
        const normalized = response.items.map(item => ({
          id: item.id,
          fileUrl: item.fileUrl,
          thumbUrl: item.thumbUrl,
          width: item.width,
          height: item.height,
          photographer: item.photographer,
          sourceUrl: item.sourceUrl,
          query: item.query,
          provider: item.provider
        }));
        const filtered = normalized.filter(it => !seen.has(it.id));
        filtered.forEach(it => seen.add(it.id));
        result.items = filtered;
        result.nextPage = response.nextPage || (response.items.length === actualPerPage ? startPage + 1 : null);
      }
    } else if (type === "videos") {
      const response = await pexelsSearchVideos({ query, perPage: actualPerPage, page: startPage, targetDur: 8 });
      if (response.ok) {
        const normalized = response.items.map(item => ({
          id: item.id,
          fileUrl: item.fileUrl,
          thumbUrl: item.thumbUrl,
          width: item.width,
          height: item.height,
          duration: item.duration,
          photographer: item.photographer,
          sourceUrl: item.sourceUrl,
          query: item.query,
          provider: item.provider
        }));
        const filtered = normalized.filter(it => !seen.has(it.id));
        filtered.forEach(it => seen.add(it.id));
        result.items = filtered;
        result.nextPage = response.nextPage || (response.items.length === actualPerPage ? startPage + 1 : null);
      }
    }

    // Persist seen IDs back to session (cap size)
    req.session[sessKey] = Array.from(seen).slice(-500);

    return res.json({ 
      ok: true, 
      data: { 
        ...result, 
        plan: isPro ? 'pro' : 'free',
        limits: { maxPerPage, currentPerPage: actualPerPage }
      } 
    });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: "SERVER_ERROR", detail: e?.message || "assets fetch failed" });
  }
}

export async function generateAiImages(req, res) {
  try {
    const parsed = AiImagesSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, reason: "BAD_REQUEST", detail: parsed.error.flatten() });
    }
    const { prompt, style = "realistic", count = 2 } = parsed.data;

    // Map style to Replicate model parameters
    const styleMap = {
      realistic: { model: "realistic", guidance: 7.5 },
      creative: { model: "creative", guidance: 12.0 }
    };
    const config = styleMap[style] || styleMap.realistic;

    const results = [];
    for (let i = 0; i < count; i++) {
      try {
        const result = await generateAIImage({ prompt, style: config.model, params: { guidance: config.guidance }, uid: req.user?.uid || null, jobId: `frontend-${Date.now()}`, index: i });
        if (result?.url) {
          results.push({
            id: `ai-${Date.now()}-${i}`,
            url: result.url,
            prompt,
            style,
            generated: true
          });
        }
      } catch (e) {
        console.warn(`AI image generation ${i} failed:`, e?.message);
      }
    }

    return res.json({ 
      ok: true, 
      data: { 
        images: results,
        count: results.length,
        requested: count,
        style 
      } 
    });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: "SERVER_ERROR", detail: e?.message || "AI image generation failed" });
  }
}
