import { runFFmpeg } from "./ffmpeg.js";

export async function extractCoverJpeg({ inPath, outPath, durationSec, width = 720 }) {
  if (!inPath || !outPath) throw new Error("inPath and outPath are required");
  const attempts = [];
  const mid = durationSec ? Math.max(0.1, durationSec * 0.5) : 0.5;
  const early = durationSec ? Math.min(1.0, Math.max(0.05, durationSec * 0.1)) : 0.2;
  const veryEarly = durationSec ? Math.min(0.1, Math.max(0.01, durationSec * 0.02)) : 0.1;
  attempts.push(mid, early, veryEarly);
  for (const sec of attempts) {
    try {
      const args = [
        "-ss", String(sec),
        "-i", inPath,
        "-frames:v", "1",
        "-vf", `scale='if(gt(a,1),${width},-2)':'if(gt(a,1),-2,${width})'`,
        "-q:v", "3",
        outPath,
      ];
      await runFFmpeg(args);
      return true;
    } catch (e) {
      // try next
    }
  }
  return false;
}

export default { extractCoverJpeg };


