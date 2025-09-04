import { createWriteStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function fetchImageToTmp(url) {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("IMAGE_URL_PROTOCOL");
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`IMAGE_FETCH_${res.status}`);
  const type = res.headers.get("content-type")?.split(";")[0] || "";
  const len = Number(res.headers.get("content-length") || 0);
  if (!ALLOWED_TYPES.has(type)) throw new Error("IMAGE_TYPE");
  if (len && len > MAX_BYTES) throw new Error("IMAGE_SIZE");

  const tmpPath = join(tmpdir(), `vaiform-${randomUUID()}.img`);
  const file = createWriteStream(tmpPath);
  let total = 0;
  const reader = res.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        file.destroy();
        await fs.unlink(tmpPath).catch(() => {});
        throw new Error("IMAGE_SIZE");
      }
      file.write(Buffer.from(value));
    }
  } finally {
    file.end();
  }
  return { path: tmpPath, mime: type, bytes: total };
}

export default { fetchImageToTmp };


