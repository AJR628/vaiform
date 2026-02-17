import { spawn } from 'node:child_process';
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

export default { getDurationMsFromMedia };
