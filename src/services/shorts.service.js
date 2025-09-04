import fs from "fs";
import os from "os";
import path from "path";

import { renderSolidQuoteVideo } from "../utils/ffmpeg.js";
import { uploadPublic } from "../utils/storage.js";

export function finalizeQuoteText(mode, text) {
  const t = (text || "").trim();
  if (!t) throw new Error("EMPTY_TEXT");
  if (mode === "feeling") {
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return t;
}

export async function createShortService({ ownerUid, mode, text, template, durationSec }) {
  if (!ownerUid) throw new Error("MISSING_UID");

  const jobId = `shorts-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${jobId}-`));
  const outPath = path.join(tmpRoot, "short.mp4");

  const finalQuote = finalizeQuoteText(mode, text);

  try {
    await renderSolidQuoteVideo({ outPath, text: finalQuote, durationSec, template });
  } catch (err) {
    // Surface helpful ffmpeg missing errors to caller
    throw err;
  }

  const destPath = `artifacts/${ownerUid}/${jobId}/short.mp4`;
  const { publicUrl } = await uploadPublic(outPath, destPath, "video/mp4");

  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}

  return {
    jobId,
    videoUrl: publicUrl,
    coverImageUrl: null,
    durationSec,
    usedTemplate: template,
    usedQuote: {
      text: finalQuote,
      author: null,
      attributed: false,
      isParaphrase: mode === "feeling",
    },
  };
}

export default { createShortService, finalizeQuoteText };


