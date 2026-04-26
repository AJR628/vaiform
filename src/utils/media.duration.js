import { spawn } from 'node:child_process';
import fs from 'fs';
import ffmpegPath from 'ffmpeg-static';

export async function getDurationMsFromMedia(filePath) {
  return new Promise((resolve) => {
    try {
      const args = ['-hide_banner', '-i', filePath];
      const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let buf = '';
      p.stderr.on('data', (d) => {
        buf += d.toString();
      });
      p.on('close', () => {
        const m = buf.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
        if (!m) return resolve(null);
        const h = Number(m[1]),
          mi = Number(m[2]),
          s = Number(m[3]),
          cs = Number(m[4]);
        const ms = (h * 3600 + mi * 60 + s) * 1000 + cs * 10;
        resolve(ms);
      });
      p.on('error', () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

export async function hasReadableVideoFrame(filePath, options = {}) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 5000);
  const maxStderrBytes = Math.max(0, Number(options.maxStderrBytes) || 2048);
  return new Promise((resolve) => {
    let settled = false;
    let stderr = '';
    let child = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => {
      try {
        child?.kill('SIGKILL');
      } catch {}
      finish(false);
    }, timeoutMs);

    try {
      child = spawn(
        ffmpegPath,
        ['-v', 'error', '-i', filePath, '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-'],
        { stdio: ['ignore', 'ignore', 'pipe'] }
      );
      child.stderr.on('data', (d) => {
        if (stderr.length < maxStderrBytes) {
          stderr += d.toString().slice(0, maxStderrBytes - stderr.length);
        }
      });
      child.on('close', (code) => finish(code === 0));
      child.on('error', () => finish(false));
    } catch {
      finish(false);
    }
  });
}

export default { getDurationMsFromMedia, hasReadableVideoFrame };
