// src/controllers/generate.controller.js
import admin from "firebase-admin";
import { db } from "../config/firebase.js";
import { openai } from "../config/env.js";
import { computeCost, ensureUserDoc } from "../services/credit.service.js";
import * as storage from "../services/storage.service.js";
import * as jobs from "../services/job.service.js";
import { getAdapter } from "../services/model-registry.service.js";

const DIAG = process.env.DIAG === "1";

// Helper: safe diag log
function dlog(...args) {
  if (DIAG) console.log("[DIAG]", ...args);
}

// POST /enhance
export async function enhance(req, res) {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Missing prompt" });

  try {
    const result = await openai.chat.completions.create({
      model: "gpt-4", // keep as-is per your config
      messages: [
        {
          role: "system",
          content:
            "You are an AI prompt enhancer. Make this image prompt more vivid, imaginative, and descriptive. Avoid changing the meaning.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.85,
    });

    const enhanced = result.choices[0]?.message?.content?.trim?.() ?? "";
    if (!enhanced) throw new Error("Empty enhancement from OpenAI");
    res.json({ success: true, enhanced });
  } catch (err) {
    console.error("❌ Enhance error:", err?.message || err);
    res.status(500).json({ success: false, error: "Enhancement failed." });
  }
}

// POST /generate
export async function generate(req, res) {
  try {
    let {
      email,
      prompt,
      numImages, // preferred
      count,     // legacy
      style = "realistic",
      guidance,
      steps,
      seed,
      scheduler,
      refiner,
    } = req.body;

    let n = Number(numImages ?? count ?? 1);
    if (!Number.isFinite(n)) n = 1;
    n = Math.max(1, Math.min(4, Math.floor(n))); // bound 1..4

    if (!email || !prompt) {
      return res.status(400).json({ success: false, error: "Missing email or prompt." });
    }

    // Basic moderation
    const mod = await openai.moderations.create({ input: prompt });
    if (mod.results?.[0]?.flagged) {
      return res.status(400).json({ success: false, error: "Inappropriate prompt detected." });
    }

    // Credits
    const { ref: userRef, data: userData } = await ensureUserDoc(email);
    const cost = computeCost(n);
    if ((userData.credits ?? 0) < cost) {
      return res.status(400).json({ success: false, error: "Insufficient credits" });
    }
    await userRef.update({ credits: (userData.credits ?? 0) - cost });

    // Model selection via registry
    const adapter = getAdapter(style);
    if (!adapter || typeof adapter.invoke !== "function") {
      // Refund if misconfigured
      await userRef.update({ credits: admin.firestore.FieldValue.increment(cost) });
      return res.status(500).json({ success: false, error: `No adapter found for style "${style}".` });
    }

    dlog("generate:start", { email, n, style, params: { guidance, steps, seed, scheduler, refiner } });

    const outputUrls = [];

    for (let i = 0; i < n; i++) {
      let predictionUrl, directOutput;
      try {
        const resp = await adapter.invoke({
          prompt,
          params: { guidance, steps, seed, scheduler, refiner },
        });
        predictionUrl = resp?.predictionUrl;
        directOutput = resp?.directOutput;
        dlog("adapter.invoke ok", { i, hasPredictionUrl: !!predictionUrl, hasDirect: !!directOutput });
      } catch (e) {
        // Try to surface server-side error detail if present
        const msg = e?.message || "Adapter invoke failed";
        dlog("adapter.invoke error", msg);
        // Refund on total failure below if nothing is produced
      }

      let finalOutput = directOutput;
      if (!finalOutput && predictionUrl) {
        try {
          finalOutput = await jobs.pollUntilDone(predictionUrl);
        } catch (e) {
          dlog("pollUntilDone error", e?.message || e);
        }
      }

      const urls = storage.extractUrlsFromReplicateOutput(finalOutput) || [];
      dlog("extract urls", { i, count: urls.length });

      if (!urls.length) {
        // carry on to next image; we'll refund if all fail
        continue;
      }

      const uploaded = await storage.uploadToFirebaseStorage(urls[0], email, i);
      if (uploaded) {
        outputUrls.push(uploaded);
      } else {
        dlog("uploadToFirebaseStorage failed", { i, sourceUrl: urls[0] });
      }

      // Gentle pacing
      await new Promise((r) => setTimeout(r, 1200));
    }

    // Refund on total failure
    if (outputUrls.length === 0) {
      await userRef.update({ credits: admin.firestore.FieldValue.increment(cost) });
      return res
        .status(502)
        .json({
          success: false,
          error: "Image generation failed (no output URLs). Credits refunded.",
          hint: DIAG ? "Check adapter payload & Replicate response body for 422 details." : undefined
        });
    }

    // Save generation record
    await db
      .collection("users")
      .doc(email)
      .collection("generations")
      .doc()
      .set({
        prompt,
        urls: outputUrls,
        style,
        type: "text-to-image",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    res.json({ success: true, urls: outputUrls });
  } catch (err) {
    console.error("🔥 /generate error:", err);
    res
      .status(500)
      .json({ success: false, error: "Something went wrong during image generation." });
  }
}

// POST /image-to-image
export async function imageToImage(req, res) {
  try {
    let {
      email,
      prompt,
      imageBase64,
      numImages,
      count,
      style = "pixar",
      guidance,
      steps,
      seed,
    } = req.body;

    let n = Number(numImages ?? count ?? 1);
    if (!Number.isFinite(n)) n = 1;
    n = Math.max(1, Math.min(4, Math.floor(n)));

    if (!email || !prompt || !imageBase64) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required fields (email, prompt, imageBase64)." });
    }

    const { ref: userRef, data: userData } = await ensureUserDoc(email);
    const cost = computeCost(n);
    if ((userData.credits ?? 0) < cost) {
      return res.status(400).json({ success: false, error: "Insufficient credits" });
    }
    await userRef.update({ credits: (userData.credits ?? 0) - cost });

    const adapter = getAdapter(style);
    if (!adapter || typeof adapter.invoke !== "function") {
      await userRef.update({ credits: admin.firestore.FieldValue.increment(cost) });
      return res.status(500).json({ success: false, error: `No adapter found for style "${style}".` });
    }

    dlog("imageToImage:start", { email, n, style });

    const outputUrls = [];

    for (let i = 0; i < n; i++) {
      let predictionUrl;
      try {
        const resp = await adapter.invoke({
          prompt,
          refs: [imageBase64],
          params: { guidance, steps, seed },
        });
        predictionUrl = resp?.predictionUrl;
        dlog("adapter.invoke ok", { i, hasPredictionUrl: !!predictionUrl });
      } catch (e) {
        dlog("adapter.invoke error", e?.message || e);
      }

      if (!predictionUrl) continue;

      let finalOutput;
      try {
        finalOutput = await jobs.pollUntilDone(predictionUrl);
      } catch (e) {
        dlog("pollUntilDone error", e?.message || e);
      }

      const urls = storage.extractUrlsFromReplicateOutput(finalOutput) || [];
      dlog("extract urls", { i, count: urls.length });

      if (!urls.length) continue;

      const uploaded = await storage.uploadToFirebaseStorage(urls[0], email, i);
      if (uploaded) outputUrls.push(uploaded);

      await new Promise((r) => setTimeout(r, 1200));
    }

    if (outputUrls.length === 0) {
      await userRef.update({ credits: admin.firestore.FieldValue.increment(cost) });
      return res
        .status(502)
        .json({ success: false, error: "Image-to-image generation failed. Credits refunded." });
    }

    await db
      .collection("users")
      .doc(email)
      .collection("generations")
      .doc()
      .set({
        prompt,
        style,
        type: "image-to-image",
        urls: outputUrls,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    res.json({ success: true, urls: outputUrls });
  } catch (err) {
    console.error("❌ /image-to-image error:", err);
    res.status(500).json({ success: false, error: "Image-to-image failed." });
  }
}

// POST /upscale
export async function upscale(req, res) {
  try {
    const { email, imageUrl } = req.body;
    if (!email || !imageUrl) {
      return res.status(400).json({ success: false, error: "Missing email or imageUrl." });
    }

    const { ref: userRef, data: userData } = await ensureUserDoc(email);
    const UPSCALE_COST = 10;
    if ((userData.credits ?? 0) < UPSCALE_COST) {
      return res.status(400).json({ success: false, error: "Insufficient credits" });
    }

    const { imageIdFromUrl } = await import("../utils/hash.js");
    const imgId = imageIdFromUrl(imageUrl);
    const imgRef = userRef.collection("images").doc(imgId);
    const imgSnap = await imgRef.get();

    // Already upscaled once
    if (imgSnap.exists && imgSnap.data()?.upscaledUrl) {
      return res.json({
        success: true,
        upscaledUrl: imgSnap.data().upscaledUrl,
        alreadyUpscaled: true,
      });
    }

    await userRef.update({ credits: (userData.credits ?? 0) - UPSCALE_COST });

    // Use the realesrgan adapter via predictions
    const realesrgan = (await import("../adapters/realesrgan.adapter.js")).default;
    const { predictionUrl } = await realesrgan.invoke({ refs: [imageUrl] });

    let finalOutput;
    try {
      finalOutput = await jobs.pollUntilDone(predictionUrl);
    } catch (e) {
      console.error("pollUntilDone error (upscale):", e?.message || e);
    }

    const urls = storage.extractUrlsFromReplicateOutput(finalOutput) || [];
    if (!urls.length) {
      await userRef.update({ credits: admin.firestore.FieldValue.increment(UPSCALE_COST) });
      return res.status(500).json({ success: false, error: "Upscale returned no URL." });
    }

    const uploaded = await storage.uploadToFirebaseStorage(urls[0], email, 0, {
      maxSide: 3072,
      quality: 90,
      filenamePrefix: "upscaled",
    });

    if (!uploaded) {
      await userRef.update({ credits: admin.firestore.FieldValue.increment(UPSCALE_COST) });
      return res.status(500).json({ success: false, error: "Failed to store upscaled image." });
    }

    await imgRef.set(
      {
        originalUrl: imageUrl,
        upscaledUrl: uploaded,
        upscaledAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.json({ success: true, upscaledUrl: uploaded, alreadyUpscaled: false });
  } catch (err) {
    console.error("🔥 /upscale error:", err);
    res.status(500).json({ success: false, error: "Upscale failed." });
  }
}