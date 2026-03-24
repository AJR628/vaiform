import { createWriteStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { withAbortTimeout } from './fetch.timeout.js';
import { fetchWithOutboundPolicy, isOutboundPolicyError } from './outbound.fetch.js';

// Allow larger remote sources (e.g., 4K portrait from Pexels). Default 200MB, overridable via env.
const MAX_BYTES = Number(process.env.VIDEO_MAX_BYTES || 200 * 1024 * 1024);
const HEAD_TIMEOUT_MS = Number(process.env.VIDEO_HEAD_TIMEOUT_MS || 10000);
const DOWNLOAD_TIMEOUT_MS = Number(process.env.VIDEO_DOWNLOAD_TIMEOUT_MS || 60000);
const ALLOWED_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

function videoError(code, message = code, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

async function runHeadProbe(url) {
  try {
    const { response } = await withAbortTimeout(
      async (signal) => await fetchWithOutboundPolicy(url, { method: 'HEAD', signal }),
      { timeoutMs: HEAD_TIMEOUT_MS, errorMessage: 'VIDEO_HEAD_TIMEOUT' }
    );

    if (!response.ok) {
      return;
    }

    const lenHead = Number(response.headers.get('content-length') || 0);
    if (lenHead && lenHead > MAX_BYTES) {
      throw videoError('VIDEO_SIZE', 'Remote video exceeds size limit');
    }
  } catch (error) {
    if (error?.code === 'VIDEO_SIZE' || isOutboundPolicyError(error)) {
      throw error;
    }

    // HEAD is best-effort only. Fall back to GET for providers that do not support it well.
    if (error?.code === 'VIDEO_HEAD_TIMEOUT') {
      console.warn('[video.fetch] HEAD probe timed out; falling back to GET');
      return;
    }
  }
}

export async function fetchVideoToTmp(url) {
  await runHeadProbe(url);

  return await withAbortTimeout(
    async (signal) => {
      const { response: res } = await fetchWithOutboundPolicy(url, { signal });
      if (!res.ok) {
        throw videoError(
          `VIDEO_FETCH_${res.status}`,
          `Remote video fetch failed (${res.status})`,
          502
        );
      }

      const type = res.headers.get('content-type')?.split(';')[0] || '';
      const len = Number(res.headers.get('content-length') || 0);
      if (!ALLOWED_TYPES.has(type)) {
        throw videoError('VIDEO_TYPE', 'Remote video must be mp4, webm, or quicktime');
      }
      if (len && len > MAX_BYTES) {
        throw videoError('VIDEO_SIZE', 'Remote video exceeds size limit');
      }
      if (!res.body) {
        throw videoError('VIDEO_FETCH_BODY_MISSING', 'Remote video response body missing', 502);
      }

      const tmpPath = join(tmpdir(), `vaiform-${randomUUID()}.vid`);
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
            throw videoError('VIDEO_SIZE', 'Remote video exceeds size limit');
          }
          file.write(Buffer.from(value));
        }
      } finally {
        file.end();
        reader.releaseLock?.();
      }
      return { path: tmpPath, mime: type, bytes: total };
    },
    { timeoutMs: DOWNLOAD_TIMEOUT_MS, errorMessage: 'VIDEO_DOWNLOAD_TIMEOUT' }
  );
}

export default { fetchVideoToTmp };
