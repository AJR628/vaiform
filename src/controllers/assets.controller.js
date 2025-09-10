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
    const maxPerPage = isPro ? 16 : 2;
    const actualPerPage = Math.min(perPage, maxPerPage);

    let result = { items: [], nextPage: null };
    
    if (type === "images") {
      const response = await pexelsSearchPhotos({ query, perPage: actualPerPage, page });
      if (response.ok) {
        result.items = response.items.map(item => ({
          id: item.id,
          url: item.fileUrl,
          thumbnail: item.thumbUrl,
          width: item.width,
          height: item.height,
          photographer: item.photographer,
          source: item.sourceUrl
        }));
        // Simple next page logic
        result.nextPage = response.items.length === actualPerPage ? page + 1 : null;
      }
    } else if (type === "videos") {
      const response = await pexelsSearchVideos({ query, perPage: actualPerPage, page, targetDur: 8 });
      if (response.ok) {
        result.items = response.items.map(item => ({
          id: item.id,
          url: item.fileUrl,
          thumbnail: item.thumbUrl,
          width: item.width,
          height: item.height,
          duration: item.duration,
          photographer: item.photographer,
          source: item.sourceUrl
        }));
        result.nextPage = response.items.length === actualPerPage ? page + 1 : null;
      }
    }

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
        const result = await generateAIImage({ 
          prompt, 
          style: config.model,
          guidance: config.guidance 
        });
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
