import { runFFmpeg } from "./ffmpeg.js";

export async function extractCoverJpeg({ inPath, outPath, second = 0.5, width = 720 }) {
  if (!inPath || !outPath) throw new Error("inPath and outPath are required");
  const args = [
    "-ss", String(second),
    "-i", inPath,
    "-frames:v", "1",
    "-vf", `scale='if(gt(a,1),${width},-2)':'if(gt(a,1),-2,${width})'`,
    "-q:v", "3",
    outPath,
  ];
  await runFFmpeg(args);
}

export default { extractCoverJpeg };


