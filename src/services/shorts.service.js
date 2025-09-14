import fs from "fs";
import os from "os";
import path from "path";

import { renderSolidQuoteVideo, renderImageQuoteVideo, runFFmpeg } from "../utils/ffmpeg.js";
import { fetchImageToTmp } from "../utils/image.fetch.js";
import { uploadPublic } from "../utils/storage.js";
import { getQuote } from "./quote.engine.js";
import { synthVoice } from "./tts.service.js";
import { resolveStockImage } from "./stock.image.provider.js";
import { resolveStockVideo } from "./stock.video.provider.js";
import { extractCoverJpeg } from "../utils/ffmpeg.cover.js";
import { generateAIImage } from "./ai.image.provider.js";
import { fetchVideoToTmp } from "../utils/video.fetch.js";
import { renderVideoQuoteOverlay } from "../utils/ffmpeg.video.js";
import admin from "../config/firebase.js";

export function finalizeQuoteText(mode, text) {
  const t = (text || "").trim();
  if (!t) throw new Error("EMPTY_TEXT");
  if (mode === "feeling") {
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return t;
}

export async function createShortService({ ownerUid, mode, text, template, durationSec, voiceover = false, wantAttribution = true, background = { kind: "solid" }, debugAudioPath, captionMode = "static", includeBottomCaption = false, watermark, overrideQuote, captionStyle, caption, voiceId }) {
  if (!ownerUid) throw new Error("MISSING_UID");

  const jobId = `shorts-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${jobId}-`));
  const outPath = path.join(tmpRoot, "short.mp4");
  const audioPath = path.join(tmpRoot, "quote.mp3");

  // Create Firestore document for tracking
  const db = admin.firestore();
  const shortsRef = db.collection('shorts').doc(jobId);
  
  try {
    try { console.log("[shorts] render opts:", { includeBottomCaption, hasCaption: !!caption, capPos: caption?.position, capAlign: caption?.align, capSize: caption?.fontSizePx }); } catch {}
    await shortsRef.set({
      ownerId: ownerUid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'processing',
      template,
      durationSec,
      quoteText: text,
      voiceId: voiceId || null,
      background: {
        kind: background.kind,
        type: background.type,
        query: background.query,
        url: background.url
      },
      mode,
      voiceover,
      wantAttribution,
      captionMode,
      watermark: watermark !== false
    });
    console.log(`[shorts] Created Firestore doc: ${jobId}`);
  } catch (error) {
    console.warn(`[shorts] Failed to create Firestore doc: ${error.message}`);
  }

  try {

  // Resolve quote using engine (curated or aphorism) unless provided
  const usedQuote = overrideQuote || await getQuote({ mode, text, template });

  const credits = {
    attributed: usedQuote.attributed === true,
    author: usedQuote.author || null,
    source: usedQuote.attributed ? "curated" : (mode === "quote" ? "user" : "generated"),
  };

  // Optional voiceover (soft-fail) with debug override
  let audioOk = false;
  let v = { audioPath: null };
  if (voiceover) {
    try {
      // Attempt with requested voice first
      const primaryOpts = { text: usedQuote.text, ...(voiceId ? { voiceId } : {}) };
      v = await synthVoice(primaryOpts);
      if (!v?.audioPath) {
        // Fallback: try again without a specific voice to let provider default
        console.warn("[shorts] TTS primary failed; retrying with default voice");
        v = await synthVoice({ text: usedQuote.text });
      }
      if (v?.audioPath) {
        try {
          fs.copyFileSync(v.audioPath, audioPath);
          audioOk = true;
          console.log("[shorts] TTS audio ready:", v.audioPath);
        } catch (e) {
          console.warn("[shorts] copy TTS audio failed:", e?.message || e);
        }
      }
    } catch (e) {
      // soft-fail
      audioOk = false;
    }
    if (debugAudioPath && fs.existsSync(debugAudioPath)) {
      try {
        fs.copyFileSync(debugAudioPath, audioPath);
        audioOk = true;
        console.log("[shorts] debugAudioPath used:", debugAudioPath);
      } catch (e) {
        console.warn("[shorts] debugAudioPath copy failed:", e?.message || e);
      }
    }
  }

  const authorLine = wantAttribution && usedQuote.attributed && usedQuote.author ? `— ${usedQuote.author}` : null;
  const watermarkFinal = (typeof watermark === "boolean")
    ? watermark
    : ((process.env.WATERMARK_ENABLED ?? "true") !== "false");

  // Karaoke ASS (optional)
  const wantKaraoke = captionMode === "karaoke";
  let karaokeModeEffective = "none";
  let assPath = null;
  if (wantKaraoke) {
    try {
      const { hasSubtitlesFilter } = await import("../utils/ffmpeg.capabilities.js");
      const canKaraoke = await hasSubtitlesFilter();
      karaokeModeEffective = canKaraoke ? "ass" : "progress";
      console.log("[karaoke] effective:", karaokeModeEffective);
      if (karaokeModeEffective === "ass") {
        const { getDurationMsFromMedia } = await import("../utils/media.duration.js");
        const { buildKaraokeASS } = await import("../utils/karaoke.ass.js");
        let karaokeDurationMs = null;
        if (audioOk) {
          karaokeDurationMs = await getDurationMsFromMedia(audioPath);
        }
        if (!karaokeDurationMs) karaokeDurationMs = durationSec * 1000;
        assPath = await buildKaraokeASS({ text: usedQuote.text, durationMs: karaokeDurationMs });
      }
    } catch (e) {
      console.warn("[karaoke] probe/build failed:", e?.message || e);
      karaokeModeEffective = "none";
      assPath = null;
    }
  }

  // Background selection with soft-fallback
  let imageTmpPath = null;
  try {
    if (background?.kind === "imageUrl" && background?.imageUrl) {
      try {
        const img = await fetchImageToTmp(background.imageUrl);
        imageTmpPath = img.path;
        await renderImageQuoteVideo({
          outPath,
          imagePath: imageTmpPath,
          durationSec,
          text: usedQuote.text,
          authorLine,
          kenBurns: background.kenBurns,
          assPath,
          progressBar: karaokeModeEffective === "progress",
          watermark: watermarkFinal,
        });
      } catch (e) {
        console.warn("[background] imageUrl fallback:", e?.message || e);
        await renderSolidQuoteVideo({ outPath, text: usedQuote.text, durationSec, template, authorLine, assPath, progressBar: karaokeModeEffective === "progress", watermark: watermarkFinal });
      }
    } else if (background?.kind === "stock" && background?.query) {
      // Handle both image and video stock backgrounds
      if (background.type === "video" && background.url) {
        try {
          console.log(`[background] Processing stock video: ${background.url}`);
          const vid = await fetchVideoToTmp(background.url);
          // For video backgrounds, do NOT burn the main quote; allow optional bottom caption only.
          await renderVideoQuoteOverlay({
            videoPath: vid.path,
            outPath,
            durationSec,
            text: '',
            authorLine,
            ttsPath: audioOk ? v.audioPath : null,
            keepVideoAudio: background.keepVideoAudio || false,
            bgAudioVolume: background.bgAudioVolume || 0.35,
            voiceoverDelaySec: background.voiceoverDelaySec,
            tailPadSec: background.tailPadSec,
            // Prefer precise caption layout when provided; gated by includeBottomCaption
            captionText: includeBottomCaption === true ? ((caption && caption.text) || usedQuote.text) : null,
            captionStyle,
            caption: includeBottomCaption === true ? caption : null,
            watermark: watermarkFinal,
            watermarkText: "Vaiform"
          });
        } catch (e) {
          console.warn("[background] stock video fallback:", e?.message || e);
          await renderSolidQuoteVideo({ outPath, text: usedQuote.text, durationSec, template, authorLine, assPath, progressBar: karaokeModeEffective === "progress", watermark: watermarkFinal });
        }
      } else {
        // Handle stock images (existing logic)
        try {
          const stockUrl = background.url || await resolveStockImage({ query: background.query });
          const img = await fetchImageToTmp(stockUrl);
          imageTmpPath = img.path;
          await renderImageQuoteVideo({
            outPath,
            imagePath: imageTmpPath,
            durationSec,
            text: usedQuote.text,
            authorLine,
            kenBurns: background.kenBurns,
            assPath,
            progressBar: karaokeModeEffective === "progress",
            watermark: watermarkFinal,
          });
        } catch (e) {
          console.warn("[background] stock image fallback:", e?.message || e);
          await renderSolidQuoteVideo({ outPath, text: usedQuote.text, durationSec, template, authorLine, assPath, progressBar: karaokeModeEffective === "progress", watermark: watermarkFinal });
        }
      }
    } else if (background?.kind === "upload" && (background?.uploadUrl || background?.url)) {
      const uploadUrl = background.url || background.uploadUrl;
      if (background.type === "video") {
        try {
          console.log(`[background] Processing upload video: ${uploadUrl}`);
          const vid = await fetchVideoToTmp(uploadUrl);
          // Do not burn the main quote into upload videos unless explicitly enabled as bottom caption
          await renderVideoQuoteOverlay({
            videoPath: vid.path,
            outPath,
            durationSec,
            text: '',
            authorLine,
            ttsPath: audioOk ? v.audioPath : null,
            keepVideoAudio: background.keepVideoAudio || false,
            bgAudioVolume: background.bgAudioVolume || 0.35,
            voiceoverDelaySec: background.voiceoverDelaySec,
            tailPadSec: background.tailPadSec,
            captionText: includeBottomCaption === true ? ((caption && caption.text) || usedQuote.text) : null,
            captionStyle,
            caption: includeBottomCaption === true ? caption : null,
            watermark: watermarkFinal,
            watermarkText: "Vaiform"
          });
        } catch (e) {
          console.warn("[background] upload video fallback:", e?.message || e);
          await renderSolidQuoteVideo({ outPath, text: usedQuote.text, durationSec, template, authorLine, assPath });
        }
      } else {
        try {
          const img = await fetchImageToTmp(uploadUrl);
          imageTmpPath = img.path;
          await renderImageQuoteVideo({
            outPath,
            imagePath: imageTmpPath,
            durationSec,
            text: usedQuote.text,
            authorLine,
            kenBurns: background.kenBurns,
            assPath,
          });
        } catch (e) {
          console.warn("[background] upload image fallback:", e?.message || e);
          await renderSolidQuoteVideo({ outPath, text: usedQuote.text, durationSec, template, authorLine, assPath });
        }
      }
    } else if (background?.kind === "ai" && background?.prompt) {
      try {
        const ai = await generateAIImage({ prompt: background.prompt, style: background.style });
        if (ai?.path) {
          await renderImageQuoteVideo({
            outPath,
            imagePath: ai.path,
            durationSec,
            text: usedQuote.text,
            authorLine,
            kenBurns: background.kenBurns,
            assPath,
            progressBar: karaokeModeEffective === "progress",
            watermark: watermarkFinal,
          });
        } else {
          // fallback to stock using prompt as query
          try {
            const stockUrl = await resolveStockImage({ query: background.prompt });
            const img = await fetchImageToTmp(stockUrl);
            imageTmpPath = img.path;
            await renderImageQuoteVideo({
              outPath,
              imagePath: imageTmpPath,
              durationSec,
              text: usedQuote.text,
              authorLine,
              kenBurns: background.kenBurns,
              assPath,
              progressBar: karaokeModeEffective === "progress",
              watermark: watermarkFinal,
            });
          } catch (e2) {
            console.warn("[background] ai->stock fallback:", e2?.message || e2);
            await renderSolidQuoteVideo({ outPath, text: usedQuote.text, durationSec, template, authorLine, assPath, progressBar: karaokeModeEffective === "progress", watermark: watermarkFinal });
          }
        }
      } catch (e) {
        console.warn("[background] ai fallback:", e?.message || e);
        await renderSolidQuoteVideo({ outPath, text: usedQuote.text, durationSec, template, authorLine, assPath, progressBar: karaokeModeEffective === "progress", watermark: watermarkFinal });
      }
    } else if (background?.kind === "stockVideo" && (background?.query || background?.clipUrl || background?.sourceUrl)) {
      try {
        const explicitClip = background.clipUrl || background.sourceUrl || null;
        let vid;
        let creditItem = null;
        if (explicitClip) {
          vid = await fetchVideoToTmp(explicitClip);
        } else {
          const r = await resolveStockVideo({ query: background.query, targetDur: durationSec });
          const item = r?.ok && r.items && r.items[0];
          if (!item) throw new Error("NO_STOCK_VIDEO");
          creditItem = item;
          vid = await fetchVideoToTmp(item.url);
        }
        // Probe for audio presence using ffmpeg by attempting to map first audio stream
        let haveBgAudio = true;
        try {
          await runFFmpeg([
            "-i", vid.path,
            "-map", "0:a:0",
            "-t", "0.1",
            "-f", "null",
            "-",
          ]);
          haveBgAudio = true;
        } catch (probeErr) {
          const msg = (probeErr?.stderr || probeErr?.message || "").toString();
          if (/Stream specifier matches no streams|Stream map '.+0:a:0'.+`/i.test(msg) || /Audio:/.test(msg) === false) {
            haveBgAudio = false;
          }
        }
        const haveTTS = audioOk;
        const keepVideoAudio = (background.keepVideoAudio !== undefined) ? !!background.keepVideoAudio : false;
        const bgAudioVolumeRaw = (typeof background.bgAudioVolume === "number") ? background.bgAudioVolume : (haveTTS ? 0.25 : 1.0);
        const bgAudioVolume = Math.max(0, Math.min(1, bgAudioVolumeRaw));
        const duckDuringTTS = keepVideoAudio && ((background.duckDuringTTS !== undefined) ? !!background.duckDuringTTS : false);
        const duck = duckDuringTTS ? {
          threshold: background.duck?.threshold ?? -18,
          ratio: background.duck?.ratio ?? 8,
          attack: background.duck?.attack ?? 40,
          release: background.duck?.release ?? 250,
        } : undefined;
        await renderVideoQuoteOverlay({
          videoPath: vid.path,
          outPath,
          durationSec,
          text: '',
          authorLine,
          watermark: watermarkFinal,
          ttsPath: audioOk ? audioPath : undefined,
          keepVideoAudio,
          bgAudioVolume,
          duckDuringTTS,
          duck,
          videoStartSec: Number(background.videoStartSec || 0),
          videoVignette: background.videoVignette === true,
          haveBgAudio,
          captionText: includeBottomCaption === true ? ((caption && caption.text) || usedQuote.text) : null,
          caption: includeBottomCaption === true ? caption : null,
        });
        // annotate meta via closure var? We'll include via meta build below
        // For parity with others, nothing else here; mux will run later
      } catch (e) {
        console.warn("[background] stockVideo render error:", e?.message || e);
        const err = new Error("RENDER_FAILED");
        err.detail = e?.message || String(e);
        err.filter = e?.filter;
        throw err;
      }
    } else {
      await renderSolidQuoteVideo({ outPath, text: usedQuote.text, durationSec, template, authorLine });
    }
  } catch (err) {
    // Surface helpful ffmpeg missing errors to caller
    throw err;
  }

  // If audio present, mux it (soft-fail if mux fails) with explicit stream mapping
  let muxedPath = outPath;
  if (audioOk) {
    const muxOut = path.join(tmpRoot, "short_mx.mp4");
    try {
      const args = [
        "-i", outPath,
        "-i", audioPath,
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
        muxOut,
      ];
      await runFFmpeg(args);
      muxedPath = muxOut;
    } catch (e) {
      // proceed silently without audio
      muxedPath = outPath;
    }
  }

  const destBase = `artifacts/${ownerUid}/${jobId}`;
  const destPath = `${destBase}/short.mp4`;
  console.log("[shorts] uploading", audioOk ? "muxed (with audio)" : "silent", "video");
  const { publicUrl } = await uploadPublic(muxedPath, destPath, "video/mp4");

  // Extract and upload cover thumbnail (best-effort)
  const coverLocal = path.join(tmpRoot, "cover.jpg");
  let coverUrl = null;
  try {
    const ok = await extractCoverJpeg({ inPath: muxedPath, outPath: coverLocal, durationSec, width: 720 });
    if (fs.existsSync(coverLocal)) {
      const coverDest = `${destBase}/cover.jpg`;
      const { publicUrl: cUrl } = await uploadPublic(coverLocal, coverDest, "image/jpeg");
      coverUrl = cUrl;
    }
  } catch (e) {
    // ignore cover failures
  }

  // Upload meta.json (best-effort)
  try {
    const meta = {
      jobId,
      uid: ownerUid,
      createdAt: new Date().toISOString(),
      durationSec,
      usedTemplate: template,
      usedQuote,
      credits,
      files: { video: "short.mp4", cover: "cover.jpg" },
      urls: { video: publicUrl, cover: coverUrl },
    };
    const metaLocal = path.join(tmpRoot, "meta.json");
    fs.writeFileSync(metaLocal, JSON.stringify(meta, null, 2));
    await uploadPublic(metaLocal, `${destBase}/meta.json`, "application/json");
  } catch (e) {
    console.warn("[shorts] meta upload failed:", e?.message || e);
  }

  try { if (imageTmpPath) fs.unlinkSync(imageTmpPath); } catch {}
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}

  // Update Firestore document with success (or audio error)
  try {
    await shortsRef.update({
      status: audioOk ? 'ready' : (voiceover ? 'error_audio' : 'ready'),
      videoUrl: publicUrl,
      coverImageUrl: coverUrl,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      audioOk: !!audioOk,
      usedQuote: {
        text: (usedQuote?.text || '').trim(),
        author: usedQuote?.author ?? null,
        attributed: !!usedQuote?.attributed,
        isParaphrase: !!usedQuote?.isParaphrase
      }
    });
    console.log(`[shorts] Updated Firestore doc to ready: ${jobId}`);
  } catch (error) {
    console.warn(`[shorts] Failed to update Firestore doc: ${error.message}`);
  }

    return {
      jobId,
      videoUrl: publicUrl,
      coverImageUrl: coverUrl,
      durationSec,
      usedTemplate: template,
      usedQuote,
      credits,
    };
  } catch (error) {
    // Update Firestore document with failure
    try {
      await shortsRef.update({
        status: 'failed',
        errorMessage: String(error.message || error).slice(0, 2000),
        failedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log(`[shorts] Updated Firestore doc to failed: ${jobId}`);
    } catch (firestoreError) {
      console.warn(`[shorts] Failed to update Firestore doc on error: ${firestoreError.message}`);
    }
    
    // Clean up temp files
    try { if (imageTmpPath) fs.unlinkSync(imageTmpPath); } catch {}
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
    
    throw error; // Re-throw the original error
  }
}

export default { createShortService, finalizeQuoteText };


