import fs from "fs";
import os from "os";
import path from "path";

import { renderSolidQuoteVideo, runFFmpeg } from "../utils/ffmpeg.js";
import { uploadPublic } from "../utils/storage.js";
import { getQuote } from "./quote.engine.js";
import { synthVoice } from "./tts.service.js";

export function finalizeQuoteText(mode, text) {
  const t = (text || "").trim();
  if (!t) throw new Error("EMPTY_TEXT");
  if (mode === "feeling") {
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return t;
}

export async function createShortService({ ownerUid, mode, text, template, durationSec, voiceover = false, wantAttribution = true }) {
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

  try {
    const authorLine = wantAttribution && usedQuote.attributed && usedQuote.author ? `— ${usedQuote.author}` : null;
    await renderSolidQuoteVideo({ outPath, text: usedQuote.text, durationSec, template, authorLine });
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

  const destPath = `artifacts/${ownerUid}/${jobId}/short.mp4`;
  const { publicUrl } = await uploadPublic(muxedPath, destPath, "video/mp4");

  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}

  return {
    jobId,
    videoUrl: publicUrl,
    coverImageUrl: null,
    durationSec,
    usedTemplate: template,
    usedQuote,
  };
}

export default { createShortService, finalizeQuoteText };


