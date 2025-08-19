import admin from 'firebase-admin';
import { db } from '../config/firebase.js';
import { openai } from '../config/env.js';
import {
  computeCost,
  ensureUserDocByUid,
  debitCreditsTx,
  refundCredits,
} from '../services/credit.service.js';
import * as storage from '../services/storage.service.js';
import * as jobs from '../services/job.service.js';

// ⏱️ Timeout + retry wrapper
import { withTimeoutAndRetry } from '../utils/withTimeoutAndRetry.js';

// Model registry + adapters
import { resolveStyle } from '../config/models.js';
import { ADAPTERS, MODELS } from '../adapters/index.js';

const DIAG = process.env.DIAG === '1';

// Helper: safe diag log
function dlog(...args) {
  if (DIAG) console.log('[DIAG]', ...args);
}

// Helpers: normalize numeric-ish fields
function toInt(val) {
  if (val === null || val === undefined || val === '') return undefined;
  const n = Number(val);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}
function toNum(val) {
  if (val === null || val === undefined || val === '') return undefined;
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

/* ===========================
 * POST /enhance
 * =========================== */
export async function enhance(req, res) {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ success: false, error: 'Missing prompt' });

  try {
    const result = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content:
            'You are an AI prompt enhancer. Make this image prompt more vivid, imaginative, and descriptive. Avoid changing the meaning.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.85,
    });

    const enhanced = result.choices?.[0]?.message?.content?.trim?.() ?? '';
    if (!enhanced) throw new Error('Empty enhancement from OpenAI');
    res.json({ success: true, enhanced });
  } catch (err) {
    console.error('❌ Enhance error:', err?.message || err);
    res.status(500).json({ success: false, error: 'Enhancement failed.' });
  }
}

/* ===========================
 * POST /generate  (text → image)
 * - Trusts req.user.uid/email
 * - Atomic credit debit
 * - Uses model registry + adapter layer
 * - Timeout/retry diagnostics:
 *    - header x-diag-force-timeout=1  (or ?diag=timeout or FORCE_TIMEOUT=1)
 *    - header x-diag-bad-model=1      (or ?diag=badmodel or BAD_MODEL=1)
 * =========================== */
export async function generate(req, res) {
  try {
    const uid = req.user?.uid;
    const email = req.user?.email || null;
    if (!uid) return res.status(401).json({ success: false, error: 'UNAUTHENTICATED' });

    let {
      prompt,
      numImages,          // preferred
      count,              // legacy
      style = 'realistic',
      guidance,
      steps,
      seed,
      scheduler,
      refiner,
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Missing prompt.' });
    }

    // Basic moderation
    const mod = await openai.moderations.create({ input: prompt });
    if (mod.results?.[0]?.flagged) {
      return res.status(400).json({ success: false, error: 'Inappropriate prompt detected.' });
    }

    // Registry chooses model + defaults
    const { modelId, entry, params } = resolveStyle(style);

    // How many images? Bound by model max and 1..4 safety
    let requested = Number(numImages ?? count ?? 1);
    if (!Number.isFinite(requested)) requested = 1;
    const maxImages = entry?.maxImages ?? 4;
    const n = Math.max(1, Math.min(maxImages, Math.floor(requested)));

    // 🔒 Ensure user doc & atomically debit credits
    await ensureUserDocByUid(uid, email);
    const cost = computeCost(n);
    try {
      await debitCreditsTx(uid, cost);
    } catch (e) {
      if (e?.code === 'INSUFFICIENT_CREDITS') {
        return res.status(400).json({ success: false, error: 'Insufficient credits' });
      }
      throw e;
    }

    dlog('generate:start', {
      uid, email, style, modelId, n,
      params: { guidance, steps, seed, scheduler, refiner },
    });

    // Prefer per-model adapter; else provider adapter
    const modelAdapter = MODELS[modelId];
    const providerAdapter = ADAPTERS[entry.provider];
    if (!providerAdapter) {
      await refundCredits(uid, cost);
      return res.status(500).json({ success: false, error: `No adapter for provider: ${entry.provider}` });
    }

    // Normalize numeric inputs
    const input = {
      prompt,
      num_outputs: n,
      guidance: toNum(guidance),
      steps: toInt(steps),
      seed: toInt(seed),
      scheduler,
      refiner,
      ...params, // registry defaults/presets
    };

    // Per-request diag toggles (override env)
    const forceTimeout =
      req.headers['x-diag-force-timeout'] === '1' ||
      req.query?.diag === 'timeout' ||
      process.env.FORCE_TIMEOUT === '1';

    const forceBadModel =
      req.headers['x-diag-bad-model'] === '1' ||
      req.query?.diag === 'badmodel' ||
      process.env.BAD_MODEL === '1';

    let artifacts = [];
    try {
      if (modelAdapter?.runTextToImage) {
        const result = await withTimeoutAndRetry(
          () => modelAdapter.runTextToImage(input),
          { timeoutMs: forceTimeout ? 100 : 25000, retries: 2 }
        );
        artifacts = result?.artifacts || [];
      } else {
        let providerRef = entry.providerRef || {}; // e.g. { model, version }
        if (forceBadModel) providerRef = { version: 'bogus-non-existent-version' };

        const result = await withTimeoutAndRetry(
          () => providerAdapter.runTextToImage({ ...providerRef, input }),
          { timeoutMs: forceTimeout ? 100 : 25000, retries: 2 }
        );
        artifacts = result?.artifacts || [];
      }
    } catch (e) {
      console.error('adapter error (txt2img):', e?.message || e);
      await refundCredits(uid, cost);
      return res.status(500).json({
        success: false,
        error: 'GENERATION_FAILED',
        detail: e?.message || 'Image generation failed (timeout/provider). Credits refunded.',
      });
    }

    // Upload each image to Firebase Storage
    const srcUrls = (artifacts || [])
      .filter(a => a?.type === 'image' && typeof a.url === 'string')
      .map(a => a.url);

    dlog('adapter:artifacts', { count: srcUrls.length });

    const outputUrls = [];
    for (let i = 0; i < srcUrls.length; i++) {
      try {
        const uploaded = await storage.uploadToFirebaseStorage(srcUrls[i], email || uid, i);
        if (uploaded) outputUrls.push(uploaded);
      } catch (e) {
        dlog('uploadToFirebaseStorage failed', { i, sourceUrl: srcUrls[i], msg: e?.message || e });
      }
      await new Promise((r) => setTimeout(r, 300)); // gentle pacing
    }

    if (outputUrls.length === 0) {
      await refundCredits(uid, cost);
      return res.status(502).json({
        success: false,
        error: 'Image generation failed (no output URLs). Credits refunded.',
        hint: DIAG ? 'Check adapter payload and provider response.' : undefined,
      });
    }

    await db.collection('users').doc(uid).collection('generations').doc().set({
      prompt,
      urls: outputUrls,
      style,
      modelId,
      type: 'text-to-image',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      cost,
      count: outputUrls.length,
    });

    return res.json({ success: true, urls: outputUrls });
  } catch (err) {
    console.error('🔥 /generate error:', err);
    return res.status(500).json({ success: false, error: 'Something went wrong during image generation.' });
  }
}

/* ===========================
 * POST /generate/image-to-image
 * - Accepts imageBase64 | imageData (data URL) | imageUrl
 * - Normalizes to data URL for adapters
 * - Atomic credit debit
 * - Same timeout/retry diagnostics as /generate
 * =========================== */
export async function imageToImage(req, res) {
  try {
    const uid = req.user?.uid;
    const email = req.user?.email || null;
    if (!uid) return res.status(401).json({ success: false, error: 'UNAUTHENTICATED' });

    let {
      prompt,
      imageBase64,   // raw base64 (no data: header)
      imageData,     // data URL (data:image/...;base64,AAA...)
      imageUrl,      // https://...
      numImages,
      count,
      style = 'pixar-3d',
      guidance,
      steps,
      seed,
      strength,
      scheduler,
      refiner,
    } = req.body;

    // ---- Normalize image input to a data URL the adapter can pass to provider ----
    let imageInput = null;

    if (typeof imageData === 'string' && imageData.startsWith('data:image/')) {
      imageInput = imageData;
    }
    if (!imageInput && typeof imageBase64 === 'string' && imageBase64.length > 100) {
      imageInput = `data:image/png;base64,${imageBase64}`;
    }
    if (!imageInput && typeof imageUrl === 'string' && /^https?:\/\//i.test(imageUrl)) {
      try {
        const resp = await fetch(imageUrl);
        if (!resp.ok) throw new Error(`fetch failed (${resp.status})`);
        const buf = Buffer.from(await resp.arrayBuffer());
        const b64 = buf.toString('base64');
        imageInput = `data:image/png;base64,${b64}`;
      } catch (e) {
        console.warn('imageUrl fetch → base64 failed:', e?.message || e);
      }
    }

    if (!prompt || !imageInput) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields. Provide prompt, and an image via imageBase64, imageData, or imageUrl.',
      });
    }

    // Resolve style/model (img2img)
    const { modelId, entry, params } = resolveStyle(style);
    const maxImages = entry?.maxImages ?? 4;

    let requested = Number(numImages ?? count ?? 1);
    if (!Number.isFinite(requested)) requested = 1;
    const n = Math.max(1, Math.min(maxImages, Math.floor(requested)));

    await ensureUserDocByUid(uid, email);
    const cost = computeCost(n);
    try {
      await debitCreditsTx(uid, cost);
    } catch (e) {
      if (e?.code === 'INSUFFICIENT_CREDITS') {
        return res.status(400).json({ success: false, error: 'Insufficient credits' });
      }
      throw e;
    }

    // Per-request diag toggles (override env)
    const forceTimeout =
      req.headers['x-diag-force-timeout'] === '1' ||
      req.query?.diag === 'timeout' ||
      process.env.FORCE_TIMEOUT === '1';

    const forceBadModel =
      req.headers['x-diag-bad-model'] === '1' ||
      req.query?.diag === 'badmodel' ||
      process.env.BAD_MODEL === '1';

    // Prefer per-model adapter; else provider adapter
    const modelAdapter = MODELS[modelId];
    const providerAdapter = ADAPTERS[entry.provider];
    if (!providerAdapter) {
      await refundCredits(uid, cost);
      return res.status(500).json({ success: false, error: `No adapter for provider: ${entry.provider}` });
    }

    const input = {
      prompt,
      image: imageInput,                         // data URL expected by many models
      num_outputs: n,
      strength: toNum(strength) ?? params?.strength,
      guidance: toNum(guidance),
      steps: toInt(steps),
      seed: toInt(seed),
      scheduler,
      refiner,
      ...params,                                 // defaults/presets from registry
    };

    let artifacts = [];
    try {
      if (modelAdapter?.runImageToImage) {
        const result = await withTimeoutAndRetry(
          () => modelAdapter.runImageToImage(input),
          { timeoutMs: forceTimeout ? 100 : 25000, retries: 2 }
        );
        artifacts = result?.artifacts || [];
      } else {
        let providerRef = entry.providerRef || {};
        if (forceBadModel) providerRef = { version: 'bogus-non-existent-version' };

        const result = await withTimeoutAndRetry(
          () => providerAdapter.runImageToImage({ ...providerRef, input }),
          { timeoutMs: forceTimeout ? 100 : 25000, retries: 2 }
        );
        artifacts = result?.artifacts || [];
      }
    } catch (e) {
      console.error('adapter error (img2img):', e?.message || e);
      await refundCredits(uid, cost);
      return res.status(500).json({
        success: false,
        error: 'GENERATION_FAILED',
        detail: e?.message || 'Image-to-image failed (timeout/provider). Credits refunded.',
      });
    }

    const srcUrls = (artifacts || [])
      .filter(a => a?.type === 'image' && typeof a.url === 'string')
      .map(a => a.url);

    const outputUrls = [];
    for (let i = 0; i < srcUrls.length; i++) {
      try {
        const uploaded = await storage.uploadToFirebaseStorage(srcUrls[i], email || uid, i);
        if (uploaded) outputUrls.push(uploaded);
      } catch (e) {
        console.warn('uploadToFirebaseStorage failed', { i, sourceUrl: srcUrls[i], msg: e?.message || e });
      }
      await new Promise(r => setTimeout(r, 300));
    }

    if (outputUrls.length === 0) {
      await refundCredits(uid, cost);
      return res.status(502).json({ success: false, error: 'Image-to-image generation failed. Credits refunded.' });
    }

    await db.collection('users').doc(uid).collection('generations').doc().set({
      prompt,
      style,
      modelId,
      type: 'image-to-image',
      urls: outputUrls,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      cost,
      count: outputUrls.length,
    });

    return res.json({ success: true, urls: outputUrls });
  } catch (err) {
    console.error('❌ /image-to-image error:', err);
    return res.status(500).json({ success: false, error: 'Image-to-image failed.' });
  }
}

/* ===========================
 * POST /generate/upscale
 * - Atomic credit debit
 * - Timeout/retry on invoke + poll
 * =========================== */
export async function upscale(req, res) {
  const reqId = (req.headers['x-request-id'] || '').toString();
  const idKey = (req.headers['x-idempotency-key'] || '').toString();

  try {
    const uid = req.user?.uid;
    const email = req.user?.email || null;
    if (!uid) return res.status(401).json({ success: false, error: 'UNAUTHENTICATED' });

    if (!idKey) {
      return res.status(400).json({ success: false, error: 'MISSING_IDEMPOTENCY_KEY', detail: 'Provide X-Idempotency-Key header.' });
    }

    const { imageUrl } = req.body || {};
    if (typeof imageUrl !== 'string' || !/^https?:\/\//i.test(imageUrl)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_REQUEST',
        detail: { issues: [{ path: 'imageUrl', message: 'Must be a valid URL starting with http(s)', code: 'invalid_string' }] },
      });
    }

    await ensureUserDocByUid(uid, email);

    const UPSCALE_COST = 10;
    try {
      await debitCreditsTx(uid, UPSCALE_COST);
    } catch (e) {
      if (e?.code === 'INSUFFICIENT_CREDITS') {
        return res.status(400).json({ success: false, error: 'Insufficient credits' });
      }
      throw e;
    }

    // If we’ve already upscaled this exact source, return it
    const { imageIdFromUrl } = await import('../utils/hash.js');
    const imgId = imageIdFromUrl(imageUrl);
    const imagesCol = db.collection('users').doc(uid).collection('images');
    const imgRef = imagesCol.doc(imgId);
    const imgSnap = await imgRef.get();
    if (imgSnap.exists && imgSnap.data()?.upscaledUrl) {
      return res.json({
        success: true,
        upscaledUrl: imgSnap.data().upscaledUrl,
        alreadyUpscaled: true,
      });
    }

    // Adapter: realesrgan
    const realesrgan = (await import('../adapters/realesrgan.adapter.js')).default;

    // 1) Create prediction (returns { predictionUrl })
    let predictionUrl;
    try {
      const created = await withTimeoutAndRetry(
        () => realesrgan.invoke({ refs: [imageUrl] }),
        { timeoutMs: 25000, retries: 2 }
      );
      predictionUrl = created?.predictionUrl;
      if (!predictionUrl) throw new Error('No predictionUrl returned from realesrgan.invoke');
    } catch (e) {
      console.error('[upscale] invoke failed', { reqId, idKey, msg: e?.message || e });
      await refundCredits(uid, UPSCALE_COST);
      return res.status(502).json({ success: false, error: 'Upscale create failed.', detail: e?.message });
    }

    // 2) Poll until done (add timeout/retry)
    let finalOutput;
    try {
      finalOutput = await withTimeoutAndRetry(
        () => jobs.pollUntilDone(predictionUrl),
        { timeoutMs: 25000, retries: 2 }
      );
    } catch (e) {
      console.error('[upscale] pollUntilDone failed', { reqId, idKey, predictionUrl, msg: e?.message || e });
      await refundCredits(uid, UPSCALE_COST);
      return res.status(502).json({ success: false, error: 'Upscale timed out or failed while polling.' });
    }

    // 3) Extract URLs (be generous in parsing)
    const fallbackExtract = (out) => {
      if (!out) return [];
      const urls = new Set();

      if (Array.isArray(out)) {
        out.forEach(x => (typeof x === 'string' && x.startsWith('http')) && urls.add(x));
      }
      if (out?.output) {
        const o = out.output;
        if (typeof o === 'string' && o.startsWith('http')) urls.add(o);
        if (Array.isArray(o)) {
          o.forEach(x => {
            if (typeof x === 'string' && x.startsWith('http')) urls.add(x);
            if (x && typeof x.url === 'string' && x.url.startsWith('http')) urls.add(x.url);
          });
        }
        if (o && typeof o === 'object' && typeof o.url === 'string' && o.url.startsWith('http')) {
          urls.add(o.url);
        }
      }
      if (Array.isArray(out?.urls)) {
        out.urls.forEach(u => (typeof u === 'string' && u.startsWith('http')) && urls.add(u));
      }
      return [...urls];
    };

    let urls = [];
    try {
      urls = storage.extractUrlsFromReplicateOutput(finalOutput) || [];
    } catch (_) {
      // ignore and use fallback
    }
    if (!urls.length) urls = fallbackExtract(finalOutput);

    if (!urls.length) {
      console.error('[upscale] no URLs extracted', { reqId, idKey, finalShape: typeof finalOutput });
      await refundCredits(uid, UPSCALE_COST);
      return res.status(502).json({
        success: false,
        error: 'Upscale returned no URL.',
        hint: process.env.DIAG === '1' ? 'Check adapter output shape in logs.' : undefined,
      });
    }

    // 4) Upload first result to Firebase Storage
    let uploaded;
    try {
      uploaded = await storage.uploadToFirebaseStorage(urls[0], email || uid, 0, {
        maxSide: 3072,
        quality: 90,
        filenamePrefix: 'upscaled',
      });
    } catch (e) {
      console.error('[upscale] upload failed', { reqId, idKey, msg: e?.message || e });
    }

    if (!uploaded) {
      await refundCredits(uid, UPSCALE_COST);
      return res.status(500).json({ success: false, error: 'Failed to store upscaled image.' });
    }

    await imgRef.set(
      {
        originalUrl: imageUrl,
        upscaledUrl: uploaded,
        upscaledAt: admin.firestore.FieldValue.serverTimestamp(),
        cost: UPSCALE_COST,
      },
      { merge: true }
    );

    return res.json({ success: true, upscaledUrl: uploaded, alreadyUpscaled: false });
  } catch (err) {
    console.error('🔥 /upscale error:', err);
    return res.status(500).json({ success: false, error: 'Upscale failed.' });
  }
}

