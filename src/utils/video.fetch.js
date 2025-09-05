import { createWriteStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const MAX_BYTES = 80 * 1024 * 1024; // 80 MB
const ALLOWED_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

export async function fetchVideoToTmp(url) {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("VIDEO_URL_PROTOCOL");
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`VIDEO_FETCH_${res.status}`);
  const type = res.headers.get("content-type")?.split(";")[0] || "";
  const len = Number(res.headers.get("content-length") || 0);
  if (!ALLOWED_TYPES.has(type)) throw new Error("VIDEO_TYPE");
  if (len && len > MAX_BYTES) throw new Error("VIDEO_SIZE");

  const tmpPath = join(tmpdir(), `vaiform-${randomUUID()}.vid`);
  const file = createWriteStream(tmpPath);
  let total = 0;
  const reader = res.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) { file.destroy(); await fs.unlink(tmpPath).catch(()=>{}); throw new Error("VIDEO_SIZE"); }
    file.write(Buffer.from(value));
  }
  file.end();
  return { path: tmpPath, mime: type, bytes: total };
}

export default { fetchVideoToTmp };


