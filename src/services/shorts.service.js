import fs from "fs";
import os from "os";
import path from "path";

import { renderSolidQuoteVideo, renderImageQuoteVideo, runFFmpeg } from "../utils/ffmpeg.js";
import { fetchImageToTmp } from "../utils/image.fetch.js";
import { uploadPublic } from "../utils/storage.js";
import { getQuote } from "./quote.engine.js";
import { synthVoice } from "./tts.service.js";
import { resolveStockImage } from "./stock.image.provider.js";
import { extractCoverJpeg } from "../utils/ffmpeg.cover.js";
import { generateAIImage } from "./ai.image.provider.js";

export function finalizeQuoteText(mode, text) {
  const t = (text || "").trim();
  if (!t) throw new Error("EMPTY_TEXT");
  if (mode === "feeling") {
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return t;
}

export async function createShortService({ ownerUid, mode, text, template, durationSec, voiceover = false, wantAttribution = true, background = { kind: "solid" } }) {
  if (!ownerUid) throw new Error("MISSING_UID");

  const jobId = `shorts-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${jobId}-`));
  const outPath = path.join(tmpRoot, "short.mp4");
  const audioPath = path.join(tmpRoot, "quote.mp3");

  // Resolve quote using engine (curated or aphorism)
  const usedQuote = await getQuote({ mode, text, template });

  // Optional voiceover (soft-fail)
  let audioOk = false;
  if (voiceover) {
    try {
      const v = await synthVoice({ text: usedQuote.text });
      if (v?.audioPath) {
        try { fs.copyFileSync(v.audioPath, audioPath); audioOk = true; } catch {}
      }
    } catch (e) {
      // soft-fail
      audioOk = false;
    }
  }

  const authorLine = wantAttribution && usedQuote.attributed && usedQuote.author ? `— ${usedQuote.author}` : null;

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
        });
      } catch (e) {
        console.warn("[background] imageUrl fallback:", e?.message || e);
        await renderSolidQuoteVideo({ outPath, text: usedQuote.text, durationSec, template, authorLine });
      }
    } else if (background?.kind === "stock" && background?.query) {
      try {
        const stockUrl = await resolveStockImage({ query: background.query });
        const img = await fetchImageToTmp(stockUrl);
        imageTmpPath = img.path;
        await renderImageQuoteVideo({
          outPath,
          imagePath: imageTmpPath,
          durationSec,
          text: usedQuote.text,
          authorLine,
          kenBurns: background.kenBurns,
        });
      } catch (e) {
        console.warn("[background] stock fallback:", e?.message || e);
        await renderSolidQuoteVideo({ outPath, text: usedQuote.text, durationSec, template, authorLine });
      }
    } else if (background?.kind === "upload" && background?.uploadUrl) {
      try {
        const img = await fetchImageToTmp(background.uploadUrl);
        imageTmpPath = img.path;
        await renderImageQuoteVideo({
          outPath,
          imagePath: imageTmpPath,
          durationSec,
          text: usedQuote.text,
          authorLine,
          kenBurns: background.kenBurns,
        });
      } catch (e) {
        console.warn("[background] upload fallback:", e?.message || e);
        await renderSolidQuoteVideo({ outPath, text: usedQuote.text, durationSec, template, authorLine });
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
            });
          } catch (e2) {
            console.warn("[background] ai->stock fallback:", e2?.message || e2);
            await renderSolidQuoteVideo({ outPath, text: usedQuote.text, durationSec, template, authorLine });
          }
        }
      } catch (e) {
        console.warn("[background] ai fallback:", e?.message || e);
        await renderSolidQuoteVideo({ outPath, text: usedQuote.text, durationSec, template, authorLine });
      }
    } else {
      await renderSolidQuoteVideo({ outPath, text: usedQuote.text, durationSec, template, authorLine });
    }
  } catch (err) {
    // Surface helpful ffmpeg missing errors to caller
    throw err;
  }

  // If audio present, mux it (soft-fail if mux fails)
  let muxedPath = outPath;
  if (audioOk) {
    const muxOut = path.join(tmpRoot, "short_mx.mp4");
    try {
      await runFFmpeg([
        "-i", outPath,
        "-i", audioPath,
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
        muxOut,
      ]);
      muxedPath = muxOut;
    } catch (e) {
      // proceed silently without audio
      muxedPath = outPath;
    }
  }

  const destBase = `artifacts/${ownerUid}/${jobId}`;
  const destPath = `${destBase}/short.mp4`;
  const { publicUrl } = await uploadPublic(muxedPath, destPath, "video/mp4");

  // Extract and upload cover thumbnail (best-effort)
  const coverLocal = path.join(tmpRoot, "cover.jpg");
  let coverUrl = null;
  try {
    await extractCoverJpeg({ inPath: muxedPath, outPath: coverLocal, second: 0.5, width: 720 });
    if (fs.existsSync(coverLocal)) {
      const coverDest = `${destBase}/cover.jpg`;
      const { publicUrl: cUrl } = await uploadPublic(coverLocal, coverDest, "image/jpeg");
      coverUrl = cUrl;
    }
  } catch (e) {
    // ignore cover failures
  }

  try { if (imageTmpPath) fs.unlinkSync(imageTmpPath); } catch {}
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}

  return {
    jobId,
    videoUrl: publicUrl,
    coverImageUrl: coverUrl,
    durationSec,
    usedTemplate: template,
    usedQuote,
  };
}

export default { createShortService, finalizeQuoteText };


