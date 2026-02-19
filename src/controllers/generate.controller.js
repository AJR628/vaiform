import admin from 'firebase-admin';
import { db } from '../config/firebase.js';
import { openai } from '../config/env.js';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  ensureUserDocByUid,
  debitCreditsTx,
  refundCredits,
  ensureUserDoc,
} from '../services/credit.service.js';
import { costForCount } from '../config/pricing.js';
import * as storage from '../services/storage.service.js';
import * as jobs from '../services/job.service.js';
import { ok, fail } from '../http/respond.js';

// ⏱️ Timeout + retry wrapper
import { withTimeoutAndRetry } from '../utils/withTimeoutAndRetry.js';

// Model registry + adapters
import { resolveStyle } from '../config/models.js';
import { ADAPTERS, MODELS } from '../adapters/index.js';
import { getAdapter } from '../services/model-registry.service.js';
import { replicate } from '../config/replicate.js';

const DIAG = process.env.DIAG === '1';
const DBG = process.env.VAIFORM_DEBUG === '1';

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
  if (!prompt) return fail(req, res, 400, 'Missing prompt', 'Missing prompt');

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
    return ok(req, res, { enhanced });
  } catch (err) {
    console.error('❌ Enhance error:', err?.message || err);
    return fail(req, res, 500, 'Enhancement failed.', 'Enhancement failed.');
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
  // [AI_IMAGES] Kill-switch - AI image generation disabled for v1
  return fail(
    req,
    res,
    410,
    'FEATURE_DISABLED',
    'AI image generation is not available in this version of Vaiform.'
  );

  // [AI_IMAGES] Legacy implementation (disabled for v1)
  /* eslint-disable no-unreachable */
  if (DBG) {
    console.log('→ /generate hit');
    console.log('CT:', req.headers['content-type']);
    try {
      console.log('BODY:', JSON.stringify(req.body));
    } catch {
      console.log('BODY: <unstringifiable>');
    }
  }

  // --- DIAG START ---
  const startedAt = Date.now();

  // Token presence (no secrets leaked)
  if (DBG) {
    console.log('[gen] token?', (process.env.REPLICATE_API_TOKEN || '').slice(0, 6) + '…');
  }

  // Ensure jobId is defined BEFORE any saveImageFromUrl uses it
  // (If you already define jobId later, MOVE it up here and remove the later duplicate)
  const jobId =
    (crypto.randomUUID && crypto.randomUUID()) || crypto.randomBytes(16).toString('hex');

  // Unpack inputs safely
  const body = req.body || {};
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const count = Number.isFinite(body.count) ? Math.max(1, Math.min(4, body.count)) : 1;
  const mode = body.mode || 'txt2img';
  const options = body.options || {};
  // Map provider to style for backward compatibility
  const provider = body.provider || 'realistic';
  const style = body.style || provider; // fallback to provider if style not provided

  if (DBG) {
    console.log('[gen] inputs', { hasPrompt: !!prompt, count, mode, style, provider });
  }
  // --- DIAG END ---

  try {
    const uid = req.user?.uid;
    if (!uid) {
      return fail(req, res, 401, 'UNAUTHENTICATED', 'Login required.');
    }
    const email = req.user?.email || null;

    const body = req.body || {};
    const prompt =
      (typeof body.prompt === 'string' && body.prompt) ||
      (typeof body.input?.prompt === 'string' && body.input.prompt) ||
      (typeof body.data?.prompt === 'string' && body.data.prompt) ||
      '';
    const count = Number(body.count ?? body.input?.count ?? body.data?.count ?? 1);
    const numImages = body.numImages ?? body.input?.numImages ?? body.data?.numImages;
    const style = body.style ?? body.input?.style ?? body.data?.style ?? 'realistic';
    const guidance = body.guidance ?? body.input?.guidance ?? body.data?.guidance;
    const steps = body.steps ?? body.input?.steps ?? body.data?.steps;
    const seed = body.seed ?? body.input?.seed ?? body.data?.seed;
    const scheduler = body.scheduler ?? body.input?.scheduler ?? body.data?.scheduler;
    const refiner = body.refiner ?? body.input?.refiner ?? body.data?.refiner;

    // Handle new schema structure with provider and options
    const provider = body.provider || 'realistic';
    const options = body.options || {};

    // Extract image data from options for pixar provider
    // Check both provider and style for pixar (frontend sends style)
    let imageInput = null;
    const isPixarRequest = provider === 'pixar' || style === 'pixar';

    if (DBG) {
      console.log('[gen] pixar check:', {
        provider,
        style,
        isPixarRequest,
        hasOptions: !!options,
        optionsKeys: options ? Object.keys(options) : [],
      });
    }

    if (isPixarRequest && options) {
      if (
        typeof options.image_base64 === 'string' &&
        options.image_base64.startsWith('data:image/')
      ) {
        imageInput = options.image_base64;
        if (DBG) console.log('[gen] using image_base64, length:', imageInput.length);
      } else if (typeof options.image_url === 'string' && /^https?:\/\//i.test(options.image_url)) {
        try {
          const resp = await fetch(options.image_url);
          if (!resp.ok) throw new Error(`fetch failed (${resp.status})`);
          const buf = Buffer.from(await resp.arrayBuffer());
          const b64 = buf.toString('base64');
          imageInput = `data:image/png;base64,${b64}`;
          if (DBG)
            console.log('[gen] fetched image_url, converted to base64, length:', imageInput.length);
        } catch (e) {
          console.warn('imageUrl fetch → base64 failed:', e?.message || e);
        }
      } else if (options.image) {
        imageInput = options.image;
        if (DBG) console.log('[gen] using options.image, length:', imageInput?.length || 0);
      }
    }

    if (DBG) {
      console.log('[gen] final imageInput:', {
        hasImage: !!imageInput,
        imageLength: imageInput?.length || 0,
        isPixar: isPixarRequest,
      });
    }
    if (!prompt.trim()) {
      return fail(req, res, 400, 'Missing prompt.', 'Missing prompt.');
    }

    // Basic moderation
    const mod = await openai.moderations.create({ input: prompt });
    if (mod.results?.[0]?.flagged) {
      return fail(
        req,
        res,
        400,
        'Inappropriate prompt detected.',
        'Inappropriate prompt detected.'
      );
    }

    // Check for async mode (Pixar style with X-Async header)
    const isAsync = req.get('x-async') === '1' || req.query?.async === '1';
    const idemKey = req.get('x-idempotency-key')?.trim();
    const jobId = idemKey || uuidv4();

    if (isAsync) {
      // Registry chooses model + defaults (moved up to avoid TDZ)
      const { modelId, entry, params } = resolveStyle(style);

      // 1) create pending doc (safe to overwrite fields for same jobId/idempotency)
      const genRef = admin.firestore().doc(`users/${uid}/generations/${jobId}`);
      await genRef.set(
        {
          status: 'pending',
          prompt,
          style,
          count,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // 2) charge upfront; refund later on failure (reuse your debitCreditsTx)
      const cost = costForCount(count); // use your existing pricing helper
      await debitCreditsTx(uid, cost); // existing atomic debit

      // 3) return immediately
      res.status(202).json({
        success: true,
        data: { jobId, status: 'pending' },
        requestId: req?.id ?? null,
      });

      // 4) background work (don't await)
      setImmediate(async () => {
        // Enter processing immediately so UI never shows failed while provider is running
        await genRef.set(
          {
            status: 'processing',
            startedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        try {
          // reuse your existing generation path (providers, retries, uploads, etc.)
          const result = await runGenerationInBackground({
            uid,
            style,
            prompt,
            count,
            imageInput,
            guidance,
            steps,
            seed,
            scheduler,
            refiner,
            params,
            cost,
            jobId,
          });
          const started = !!result?.started;
          const images = Array.isArray(result?.images) ? result.images : [];

          if (!images.length) {
            // No artifacts yet → keep processing and allow later finalization
            await genRef.set(
              {
                status: 'processing',
                error: 'finalizing',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
            return;
          }

          // persist success
          await genRef.set(
            {
              status: 'complete',
              images,
              urls: images, // keep legacy field for gallery rendering
              completedAt: admin.firestore.FieldValue.serverTimestamp(),
              cost: result.cost,
              error: null,
            },
            { merge: true }
          );
        } catch (e) {
          console.error('async generate failed', e);
          // If we never actually started the remote run, mark failed and refund.
          // Heuristic: if error contains 'prediction' we likely started; otherwise assume not started.
          const msg = String(e?.message || e || '');
          const likelyStarted = /prediction|replicate|poll/i.test(msg);
          if (!likelyStarted) {
            try {
              await refundCredits(uid, cost);
            } catch (rf) {
              console.error('refund failed', rf);
            }
            await genRef.set(
              {
                status: 'failed',
                error: msg,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
            return;
          }
          // Remote run likely in flight — keep processing; let a later pass finalize
          await genRef.set(
            {
              status: 'processing',
              error: msg,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
      });
      return;
    }

    // Registry chooses model + defaults
    const { modelId, entry, params } = resolveStyle(style);

    // How many images? Bound by model max and 1..4 safety
    let requested = Number(numImages ?? count ?? 1);
    if (!Number.isFinite(requested)) requested = 1;
    const maxImages = entry?.maxImages ?? 4;
    const n = Math.max(1, Math.min(maxImages, Math.floor(requested)));

    const cost = costForCount(count);

    // Ensure UID doc exists and migrate if needed
    await ensureUserDoc(uid, email);

    // Debit credits atomically
    try {
      await debitCreditsTx(uid, cost);
    } catch (e) {
      if (e?.code === 'INSUFFICIENT_CREDITS') {
        return fail(req, res, 400, 'Insufficient credits', 'Insufficient credits');
      }
      throw e;
    }

    dlog('generate:start', {
      uid,
      email,
      style,
      modelId,
      n,
      params: { guidance, steps, seed, scheduler, refiner },
    });

    // Prefer per-model adapter; else provider adapter
    const modelAdapter = MODELS[modelId];
    const providerAdapter = ADAPTERS[entry.provider];
    if (!providerAdapter) {
      await refundCredits(uid, cost);
      const adapterError = `No adapter for provider: ${entry.provider}`;
      return fail(req, res, 500, adapterError, adapterError);
    }

    // Normalize numeric inputs
    const input = {
      prompt,
      num_outputs: n,
      num_images: count, // many models use num_images (keeping n as well if you had it)
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

    // --- POLL + RAW LOG START ---
    async function waitForPrediction(replicateClient, idOrUrl, timeoutMs = 600000) {
      const t0 = Date.now();
      while (true) {
        const pred = await replicateClient.predictions.get(idOrUrl);
        if (pred?.status === 'succeeded') return pred;
        if (pred?.status === 'failed' || pred?.status === 'canceled') {
          throw new Error(`prediction-${pred?.status}: ${pred?.error || ''}`);
        }
        if (Date.now() - t0 > timeoutMs) throw new Error('prediction-timeout');
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    let artifacts = [];
    let prediction = null;
    try {
      // Handle pixar img2img case
      if (isPixarRequest && imageInput) {
        if (DBG) console.log('[gen] calling pixar adapter with image length:', imageInput.length);

        // Use the pixar adapter directly for img2img
        const pixarAdapter = getAdapter('pixar');
        const result = await withTimeoutAndRetry(
          () =>
            pixarAdapter.invoke({
              prompt,
              refs: [imageInput],
              params: { guidance, steps, seed, scheduler, refiner, ...params },
            }),
          { timeoutMs: forceTimeout ? 100 : 600000, retries: 2 }
        );

        if (DBG)
          console.log('[gen] pixar adapter result:', {
            hasPredictionUrl: !!result?.predictionUrl,
            resultKeys: result ? Object.keys(result) : [],
          });

        // Handle pixar adapter response format - it returns { predictionUrl }
        if (result.predictionUrl) {
          if (DBG) console.log('[gen] polling Replicate prediction:', result.predictionUrl);
          // Poll Replicate until the prediction completes
          const pred = await waitForPrediction(replicate, result.predictionUrl);
          prediction = pred;
          // Extract artifacts from the completed prediction
          if (pred?.output) {
            artifacts = Array.isArray(pred.output) ? pred.output : [pred.output];
          } else {
            artifacts = [];
          }
          if (DBG) console.log('[gen] prediction completed, artifacts:', artifacts.length);
        } else {
          // Fallback if no predictionUrl
          prediction = result;
          artifacts = [];
          if (DBG) console.log('[gen] no predictionUrl, using result directly');
        }
      } else if (modelAdapter?.runTextToImage) {
        const result = await withTimeoutAndRetry(() => modelAdapter.runTextToImage(input), {
          timeoutMs: forceTimeout ? 100 : 600000,
          retries: 2,
        });
        artifacts = result?.artifacts || [];
        prediction = result;
      } else {
        let providerRef = entry.providerRef || {}; // e.g. { model, version }
        if (forceBadModel) providerRef = { version: 'bogus-non-existent-version' };

        const result = await withTimeoutAndRetry(
          () => providerAdapter.runTextToImage({ ...providerRef, input }),
          { timeoutMs: forceTimeout ? 100 : 600000, retries: 2 }
        );
        artifacts = result?.artifacts || [];
        prediction = result;
      }

      // 🔎 LOG THE ENTIRE RAW PREDICTION (exactly this)
      if (DBG) {
        try {
          const s = JSON.stringify(prediction, null, 2);
          console.log(
            '[gen] raw prediction',
            s.length > 4000 ? s.slice(0, 4000) + ' …(truncated)' : s
          );
        } catch {
          console.log('[gen] raw prediction <unstringifiable>');
        }
      }
    } catch (e) {
      console.error('adapter error (txt2img):', e?.message || e);
      await refundCredits(uid, cost);
      return fail(
        req,
        res,
        500,
        'GENERATION_FAILED',
        e?.message || 'Image generation failed (timeout/provider). Credits refunded.'
      );
    }

    // --- NORMALIZE OUTPUT (updated) ---
    let urls = [];

    // 1) Preferred: artifacts[].url (new Replicate SDK shape)
    if (Array.isArray(prediction?.artifacts)) {
      urls = prediction.artifacts
        .map((a) => (a && typeof a.url === 'string' ? a.url : null))
        .filter(Boolean);
    }

    // 2) Legacy/alt: prediction.output (string | string[] | object[])
    if (!urls.length) {
      const out = prediction?.output;
      if (typeof out === 'string') {
        urls = [out];
      } else if (Array.isArray(out)) {
        urls = out
          .map((x) => (typeof x === 'string' ? x : x?.url || x?.image || x?.src))
          .filter(Boolean);
      } else if (out && typeof out === 'object') {
        urls = [out.url || out.image || out.src].filter(Boolean);
      }
    }

    // 3) Fallback: raw.output (string | string[] | object[])
    if (!urls.length && prediction?.raw) {
      const r = prediction.raw;
      if (typeof r.output === 'string') {
        urls = [r.output];
      } else if (Array.isArray(r.output)) {
        urls = r.output
          .map((x) => (typeof x === 'string' ? x : x?.url || x?.image || x?.src))
          .filter(Boolean);
      } else if (r.output && typeof r.output === 'object') {
        urls = [r.output.url || r.output.image || r.output.src].filter(Boolean);
      }
    }

    console.log('[gen] urls', urls);

    if (!urls.length) {
      await refundCredits(uid, cost);
      return fail(
        req,
        res,
        502,
        'Image generation failed (no output URLs). Credits refunded.',
        'Image generation failed (no output URLs). Credits refunded.'
      );
    }

    // If caller asked for multiple images but we have fewer URLs,
    // run additional single-image predictions until we reach `count`.
    if (count > 1 && urls.length < count) {
      console.log('[gen] need more images', { have: urls.length, want: count });

      async function generateOneUrl() {
        // Use the same adapter pattern as the main generation
        const singleInput = {
          prompt,
          num_outputs: 1,
          num_images: 1,
          guidance: toNum(guidance),
          steps: toInt(steps),
          seed: toInt(seed),
          scheduler,
          refiner,
          ...params, // registry defaults/presets
        };

        let singlePrediction = null;
        if (modelAdapter?.runTextToImage) {
          singlePrediction = await withTimeoutAndRetry(
            () => modelAdapter.runTextToImage(singleInput),
            { timeoutMs: forceTimeout ? 100 : 600000, retries: 2 }
          );
        } else {
          let providerRef = entry.providerRef || {};
          if (forceBadModel) providerRef = { version: 'bogus-non-existent-version' };

          singlePrediction = await withTimeoutAndRetry(
            () => providerAdapter.runTextToImage({ ...providerRef, input: singleInput }),
            { timeoutMs: forceTimeout ? 100 : 600000, retries: 2 }
          );
        }

        // Normalize like your main path (artifacts → output → raw.output)
        if (Array.isArray(singlePrediction?.artifacts) && singlePrediction.artifacts[0]?.url) {
          return singlePrediction.artifacts[0].url;
        }
        if (typeof singlePrediction?.output === 'string') return singlePrediction.output;
        if (Array.isArray(singlePrediction?.output)) {
          const u = singlePrediction.output
            .map((x) => (typeof x === 'string' ? x : x?.url || x?.image || x?.src))
            .find(Boolean);
          if (u) return u;
        }
        if (singlePrediction?.raw?.output) {
          const r = singlePrediction.raw.output;
          if (typeof r === 'string') return r;
          if (Array.isArray(r)) {
            const u = r
              .map((x) => (typeof x === 'string' ? x : x?.url || x?.image || x?.src))
              .find(Boolean);
            if (u) return u;
          }
          if (typeof r === 'object' && (r.url || r.image || r.src))
            return r.url || r.image || r.src;
        }
        throw new Error('no-url-from-additional-prediction');
      }

      while (urls.length < count) {
        const extraUrl = await generateOneUrl();
        urls.push(extraUrl);
      }
    }

    console.log('[gen] urls', urls);

    // Upload each image to Firebase Storage
    const srcUrls = urls;

    const outputUrls = [];
    for (let i = 0; i < srcUrls.length; i++) {
      try {
        const result = await storage.saveImageFromUrl(uid, jobId, srcUrls[i], { index: i });
        if (result?.publicUrl) outputUrls.push(result.publicUrl);
      } catch (e) {
        dlog('saveImageFromUrl failed', { i, sourceUrl: srcUrls[i], msg: e?.message || e });
      }
      await new Promise((r) => setTimeout(r, 300)); // gentle pacing
    }

    await db.collection('users').doc(uid).collection('generations').doc(jobId).set({
      prompt,
      urls: outputUrls,
      style,
      modelId,
      type: 'text-to-image',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      cost,
      count: outputUrls.length,
    });

    console.log('[gen] done', { jobId, count, ms: Date.now() - startedAt });

    return ok(req, res, { images: outputUrls, jobId, cost });
  } catch (err) {
    console.error('🔥 /generate error:', err);
    return fail(
      req,
      res,
      500,
      'Something went wrong during image generation.',
      'Something went wrong during image generation.'
    );
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
  // [AI_IMAGES] Kill-switch - image-to-image disabled for v1
  return fail(
    req,
    res,
    410,
    'FEATURE_DISABLED',
    'AI image generation is not available in this version of Vaiform.'
  );

  // [AI_IMAGES] Legacy implementation (disabled for v1)
  /* eslint-disable no-unreachable */
  const startedAt = Date.now();
  try {
    const uid = req.user?.uid;
    if (!uid) {
      return fail(req, res, 401, 'UNAUTHENTICATED', 'Login required.');
    }
    const email = req.user?.email || null;

    let {
      prompt,
      imageBase64, // raw base64 (no data: header)
      imageData, // data URL (data:image/...;base64,AAA...)
      imageUrl, // https://...
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
      const missingFieldsError =
        'Missing required fields. Provide prompt, and an image via imageBase64, imageData, or imageUrl.';
      return fail(req, res, 400, missingFieldsError, missingFieldsError);
    }

    // Resolve style/model (img2img)
    const { modelId, entry, params } = resolveStyle(style);
    const maxImages = entry?.maxImages ?? 4;

    let requested = Number(numImages ?? count ?? 1);
    if (!Number.isFinite(requested)) requested = 1;
    const n = Math.max(1, Math.min(maxImages, Math.floor(requested)));

    await ensureUserDocByUid(uid, email);
    const cost = costForCount(n);
    try {
      await debitCreditsTx(uid, cost);
    } catch (e) {
      if (e?.code === 'INSUFFICIENT_CREDITS') {
        return fail(req, res, 400, 'Insufficient credits', 'Insufficient credits');
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
      const adapterError = `No adapter for provider: ${entry.provider}`;
      return fail(req, res, 500, adapterError, adapterError);
    }

    const input = {
      prompt,
      image: imageInput, // data URL expected by many models
      num_outputs: n,
      strength: toNum(strength) ?? params?.strength,
      guidance: toNum(guidance),
      steps: toInt(steps),
      seed: toInt(seed),
      scheduler,
      refiner,
      ...params, // defaults/presets from registry
    };

    let artifacts = [];
    try {
      if (modelAdapter?.runImageToImage) {
        const result = await withTimeoutAndRetry(() => modelAdapter.runImageToImage(input), {
          timeoutMs: forceTimeout ? 100 : 600000,
          retries: 2,
        });
        artifacts = result?.artifacts || [];
      } else {
        let providerRef = entry.providerRef || {};
        if (forceBadModel) providerRef = { version: 'bogus-non-existent-version' };

        const result = await withTimeoutAndRetry(
          () => providerAdapter.runImageToImage({ ...providerRef, input }),
          { timeoutMs: forceTimeout ? 100 : 600000, retries: 2 }
        );
        artifacts = result?.artifacts || [];
      }
    } catch (e) {
      console.error('adapter error (img2img):', e?.message || e);
      await refundCredits(uid, cost);
      return fail(
        req,
        res,
        500,
        'GENERATION_FAILED',
        e?.message || 'Image-to-image failed (timeout/provider). Credits refunded.'
      );
    }

    const srcUrls = (artifacts || [])
      .filter((a) => a?.type === 'image' && typeof a.url === 'string')
      .map((a) => a.url);

    const outputUrls = [];
    for (let i = 0; i < srcUrls.length; i++) {
      try {
        const result = await storage.saveImageFromUrl(uid, jobId, srcUrls[i], { index: i });
        if (result?.publicUrl) outputUrls.push(result.publicUrl);
      } catch (e) {
        console.warn('saveImageFromUrl failed', { i, sourceUrl: srcUrls[i], msg: e?.message || e });
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    if (outputUrls.length === 0) {
      await refundCredits(uid, cost);
      return fail(
        req,
        res,
        502,
        'Image-to-image generation failed. Credits refunded.',
        'Image-to-image generation failed. Credits refunded.'
      );
    }

    const jobId = db.collection('users').doc(uid).collection('generations').doc().id;

    await db.collection('users').doc(uid).collection('generations').doc(jobId).set({
      prompt,
      style,
      modelId,
      type: 'image-to-image',
      urls: outputUrls,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      cost,
      count: outputUrls.length,
    });

    console.log('[gen] done', { jobId, count, ms: Date.now() - startedAt });

    return ok(req, res, { images: outputUrls, jobId, cost });
  } catch (err) {
    console.error('❌ /image-to-image error:', err);
    return fail(req, res, 500, 'Image-to-image failed.', 'Image-to-image failed.');
  }
}

/* ===========================
 * POST /generate/upscale
 * - Atomic credit debit
 * - Timeout/retry on invoke + poll
 * =========================== */
export async function upscale(req, res) {
  // [AI_IMAGES] Kill-switch - image upscaling disabled for v1
  return fail(
    req,
    res,
    410,
    'FEATURE_DISABLED',
    'Image upscaling is not available in this version of Vaiform.'
  );

  // [AI_IMAGES] Legacy implementation (disabled for v1)
  /* eslint-disable no-unreachable */
  const reqId = (req.headers['x-request-id'] || '').toString();

  try {
    const uid = req.user?.uid;
    if (!uid) {
      return fail(req, res, 401, 'UNAUTHENTICATED', 'Login required.');
    }
    const email = req.user?.email || null;

    const { imageUrl } = req.body || {};

    await ensureUserDocByUid(uid, email);

    const jobId = db.collection('users').doc(uid).collection('generations').doc().id;

    const UPSCALE_COST = 10;
    try {
      await debitCreditsTx(uid, UPSCALE_COST);
    } catch (e) {
      if (e?.code === 'INSUFFICIENT_CREDITS') {
        return fail(req, res, 400, 'Insufficient credits', 'Insufficient credits');
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
      return ok(req, res, { upscaledUrl: imgSnap.data().upscaledUrl, alreadyUpscaled: true });
    }

    // Adapter: realesrgan
    const realesrgan = (await import('../adapters/realesrgan.adapter.js')).default;

    // 1) Create prediction (returns { predictionUrl })
    let predictionUrl;
    try {
      const created = await withTimeoutAndRetry(() => realesrgan.invoke({ refs: [imageUrl] }), {
        timeoutMs: 300000,
        retries: 2,
      });
      predictionUrl = created?.predictionUrl;
      if (!predictionUrl) throw new Error('No predictionUrl returned from realesrgan.invoke');
    } catch (e) {
      console.error('[upscale] invoke failed', { reqId, msg: e?.message || e });
      await refundCredits(uid, UPSCALE_COST);
      return fail(req, res, 502, 'Upscale create failed.', e?.message || 'Upscale create failed.');
    }

    // 2) Poll until done (add timeout/retry)
    let finalOutput;
    try {
      finalOutput = await withTimeoutAndRetry(() => jobs.pollUntilDone(predictionUrl), {
        timeoutMs: 600000,
        retries: 2,
      });
    } catch (e) {
      console.error('[upscale] pollUntilDone failed', {
        reqId,
        predictionUrl,
        msg: e?.message || e,
      });
      await refundCredits(uid, UPSCALE_COST);
      return fail(
        req,
        res,
        502,
        'Upscale timed out or failed while polling.',
        'Upscale timed out or failed while polling.'
      );
    }

    // 3) Extract URLs (be generous in parsing)
    const fallbackExtract = (out) => {
      if (!out) return [];
      const urls = new Set();

      if (Array.isArray(out)) {
        out.forEach((x) => typeof x === 'string' && x.startsWith('http') && urls.add(x));
      }
      if (out?.output) {
        const o = out.output;
        if (typeof o === 'string' && o.startsWith('http')) urls.add(o);
        if (Array.isArray(o)) {
          o.forEach((x) => {
            if (typeof x === 'string' && x.startsWith('http')) urls.add(x);
            if (x && typeof x.url === 'string' && x.url.startsWith('http')) urls.add(x.url);
          });
        }
        if (o && typeof o === 'object' && typeof o.url === 'string' && o.url.startsWith('http')) {
          urls.add(o.url);
        }
      }
      if (Array.isArray(out?.urls)) {
        out.urls.forEach((u) => typeof u === 'string' && u.startsWith('http') && urls.add(u));
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
      console.error('[upscale] no URLs extracted', { reqId, finalShape: typeof finalOutput });
      await refundCredits(uid, UPSCALE_COST);
      const detail =
        process.env.DIAG === '1'
          ? 'Upscale returned no URL. Check adapter output shape in logs.'
          : 'Upscale returned no URL.';
      return fail(req, res, 502, 'Upscale returned no URL.', detail);
    }

    // 4) Upload first result to Firebase Storage
    let uploaded;
    try {
      const result = await storage.saveImageFromUrl(uid, jobId, urls[0], {
        index: 0,
        recompress: true,
        maxSide: 3072,
        webpQuality: 90,
      });
      uploaded = result?.publicUrl;
    } catch (e) {
      console.error('[upscale] upload failed', { reqId, msg: e?.message || e });
    }

    if (!uploaded) {
      await refundCredits(uid, UPSCALE_COST);
      return fail(
        req,
        res,
        500,
        'Failed to store upscaled image.',
        'Failed to store upscaled image.'
      );
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

    return ok(req, res, { upscaledUrl: uploaded, alreadyUpscaled: false });
  } catch (err) {
    console.error('🔥 /upscale error:', err);
    return fail(req, res, 500, 'Upscale failed.', 'Upscale failed.');
  }
}

/* ===========================
 * Background generation function for async mode
 * =========================== */
async function runGenerationInBackground({
  uid,
  style,
  prompt,
  count,
  imageInput,
  guidance,
  steps,
  seed,
  scheduler,
  refiner,
  params,
  cost,
  jobId,
}) {
  try {
    // Local poller to avoid scope issues
    async function waitForPredictionLocal(replicateClient, idOrUrl, timeoutMs = 600000) {
      const t0 = Date.now();
      while (true) {
        const pred = await replicateClient.predictions.get(idOrUrl);
        if (pred?.status === 'succeeded') return pred;
        if (pred?.status === 'failed' || pred?.status === 'canceled') {
          throw new Error(`prediction-${pred?.status}: ${pred?.error || ''}`);
        }
        if (Date.now() - t0 > timeoutMs) throw new Error('prediction-timeout');
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    // Registry chooses model + defaults
    const { modelId, entry, params: modelParams } = resolveStyle(style);

    // How many images? Bound by model max and 1..4 safety
    let requested = Number(count ?? 1);
    if (!Number.isFinite(requested)) requested = 1;
    const maxImages = entry?.maxImages ?? 4;
    const n = Math.max(1, Math.min(maxImages, Math.floor(requested)));

    // Prefer per-model adapter; else provider adapter
    const modelAdapter = MODELS[modelId];
    const providerAdapter = ADAPTERS[entry.provider];
    if (!providerAdapter) {
      throw new Error(`No adapter for provider: ${entry.provider}`);
    }

    // Normalize numeric inputs
    const input = {
      prompt,
      num_outputs: n,
      num_images: count,
      guidance: toNum(guidance),
      steps: toInt(steps),
      seed: toInt(seed),
      scheduler,
      refiner,
      ...modelParams, // registry defaults/presets
    };

    let artifacts = [];
    let prediction = null;

    // Handle pixar img2img case
    if (style === 'pixar' && imageInput) {
      const pixarAdapter = getAdapter('pixar');
      const result = await withTimeoutAndRetry(
        () =>
          pixarAdapter.invoke({
            prompt,
            refs: [imageInput],
            params: { guidance, steps, seed, scheduler, refiner, ...modelParams },
          }),
        { timeoutMs: 600000, retries: 2 }
      );

      if (result.predictionUrl) {
        // Poll Replicate until the prediction completes
        const pred = await waitForPredictionLocal(replicate, result.predictionUrl);
        // Normalize output to URLs (string | string[] | object[])
        let urls = [];
        try {
          urls = storage.extractUrlsFromReplicateOutput(pred) || [];
        } catch {}
        if (!urls.length) {
          const out = pred?.output;
          if (typeof out === 'string') urls = [out];
          else if (Array.isArray(out)) {
            urls = out
              .map((x) => (typeof x === 'string' ? x : x?.url || x?.image || x?.src))
              .filter(Boolean);
          } else if (out && typeof out === 'object') {
            urls = [out.url || out.image || out.src].filter(Boolean);
          }
        }
        artifacts = urls;
      }
    } else {
      // Handle text-to-image case
      const result = await withTimeoutAndRetry(
        () => providerAdapter.invoke({ prompt, count: n, options: input }),
        { timeoutMs: 600000, retries: 2 }
      );

      if (result.predictionUrl) {
        const pred = await waitForPredictionLocal(replicate, result.predictionUrl);
        // Normalize output to URLs
        let urls = [];
        try {
          urls = storage.extractUrlsFromReplicateOutput(pred) || [];
        } catch {}
        if (!urls.length) {
          const out = pred?.output;
          if (typeof out === 'string') urls = [out];
          else if (Array.isArray(out)) {
            urls = out
              .map((x) => (typeof x === 'string' ? x : x?.url || x?.image || x?.src))
              .filter(Boolean);
          } else if (out && typeof out === 'object') {
            urls = [out.url || out.image || out.src].filter(Boolean);
          }
        }
        artifacts = urls;
      }
    }

    // Extract URLs and upload to storage
    const outputUrls = [];
    for (let i = 0; i < artifacts.length; i++) {
      try {
        const srcUrl = artifacts[i];
        const result = await storage.saveImageFromUrl(uid, jobId, srcUrl, {
          index: i,
          recompress: true,
          maxSide: 3072,
          webpQuality: 90,
        });
        if (result?.publicUrl) {
          outputUrls.push(result.publicUrl);
        }
      } catch (e) {
        console.error(`[async-gen] upload failed for artifact ${i}:`, e?.message || e);
      }
    }

    if (!outputUrls.length) {
      return { started: true, images: [], cost };
    }

    return { started: true, images: outputUrls, cost };
  } catch (error) {
    console.error('[async-gen] background generation failed:', error);
    throw error;
  }
}

/* ===========================
 * GET /job/:jobId - Get job status
 * =========================== */
export async function jobStatus(req, res) {
  // [AI_IMAGES] Kill-switch - image job polling disabled for v1
  return fail(
    req,
    res,
    410,
    'FEATURE_DISABLED',
    'Image job polling is not available in this version of Vaiform.'
  );

  // [AI_IMAGES] Legacy implementation (disabled for v1)
  /* eslint-disable no-unreachable */
  try {
    const uid = req.user?.uid;
    if (!uid) {
      return fail(req, res, 401, 'UNAUTHENTICATED', 'Login required.');
    }

    const { jobId } = req.params;
    if (!jobId) {
      return fail(req, res, 400, 'Missing jobId', 'Missing jobId');
    }

    const snap = await admin.firestore().doc(`users/${uid}/generations/${jobId}`).get();
    if (!snap.exists) {
      return fail(req, res, 404, 'NOT_FOUND', 'NOT_FOUND');
    }

    const data = snap.data();
    return ok(req, res, data);
  } catch (e) {
    console.error('jobStatus error', e);
    return fail(req, res, 500, 'INTERNAL', 'INTERNAL');
  }
}
