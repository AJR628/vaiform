import { AssetsOptionsSchema, AiImagesSchema } from "../schemas/quotes.schema.js";
import { pexelsSearchVideos } from "../services/pexels.videos.provider.js";
import { pexelsSearchPhotos } from "../services/pexels.photos.provider.js";
import { generateAIImage } from "../services/ai.image.provider.js";
import { ensureUserDoc, debitCreditsTx, refundCredits } from "../services/credit.service.js";

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
        meta: { type, query, page: startPage }, // Debug: show what was requested
        plan: isPro ? 'pro' : 'free',
        limits: { maxPerPage, currentPerPage: actualPerPage }
      } 
    });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: "SERVER_ERROR", detail: e?.message || "assets fetch failed" });
  }
}

export async function generateAiImages(req, res) {
  // [AI_IMAGES] Kill-switch - AI image generation disabled for v1
  return res.status(410).json({
    success: false,
    error: "FEATURE_DISABLED",
    detail: "AI image generation is disabled in this version of Vaiform.",
  });
  
  // [AI_IMAGES] Legacy implementation (disabled for v1)
  /* eslint-disable no-unreachable */
  try {
    const parsed = AiImagesSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, reason: "BAD_REQUEST", detail: parsed.error.flatten() });
    }
    const { prompt, style = "realistic", count = 2 } = parsed.data;
    const { uid, email } = req.user || {};

    if (!uid) {
      return res.status(401).json({ ok: false, reason: "UNAUTHENTICATED", detail: "Login required" });
    }

    // Ensure user doc exists
    await ensureUserDoc(uid, email);

    // Calculate cost: 20 credits per image
    const cost = count * 20;
    
    // Check if user has sufficient credits and debit them
    try {
      await debitCreditsTx(uid, cost);
    } catch (err) {
      if (err.code === 'INSUFFICIENT_CREDITS') {
        return res.status(400).json({ 
          ok: false, 
          reason: "INSUFFICIENT_CREDITS", 
          detail: `You need ${cost} credits to generate ${count} AI image(s). You have insufficient credits.` 
        });
      }
      throw err;
    }

    // Map style to Replicate model parameters
    const styleMap = {
      realistic: { model: "realistic", guidance: 7.5 },
      creative: { model: "creative", guidance: 12.0 }
    };
    const config = styleMap[style] || styleMap.realistic;

    const results = [];
    let successCount = 0;
    
    try {
      for (let i = 0; i < count; i++) {
        try {
          const result = await generateAIImage({ prompt, style: config.model, params: { guidance: config.guidance }, uid, jobId: `frontend-${Date.now()}`, index: i });
          if (result?.url) {
            results.push({
              id: `ai-${Date.now()}-${i}`,
              url: result.url,
              prompt,
              style,
              generated: true
            });
            successCount++;
          }
        } catch (e) {
          console.warn(`AI image generation ${i} failed:`, e?.message);
        }
      }

      // If no images were generated successfully, refund the credits
      if (successCount === 0) {
        await refundCredits(uid, cost);
        return res.status(500).json({ 
          ok: false, 
          reason: "GENERATION_FAILED", 
          detail: "All AI image generations failed. Credits have been refunded." 
        });
      }

      // If partial success, refund credits for failed generations
      if (successCount < count) {
        const failedCount = count - successCount;
        const refundAmount = failedCount * 20;
        await refundCredits(uid, refundAmount);
      }

      return res.json({ 
        ok: true, 
        data: { 
          images: results,
          count: results.length,
          requested: count,
          style,
          cost: successCount * 20,
          creditsDeducted: successCount * 20
        } 
      });
    } catch (e) {
      // If generation fails completely, refund all credits
      await refundCredits(uid, cost);
      return res.status(500).json({ 
        ok: false, 
        reason: "GENERATION_FAILED", 
        detail: e?.message || "AI image generation failed. Credits have been refunded." 
      });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, reason: "SERVER_ERROR", detail: e?.message || "AI image generation failed" });
  }
}
