// src/utils/async.js
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function withTimeout(promiseOrFn, ms, label = 'op') {
  const p = typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn;
  let to;
  const timeout = new Promise((_, rej) => {
    to = setTimeout(() => rej(new Error(`TIMEOUT:${label}:${ms}ms`)), ms);
  });
  try {
    const res = await Promise.race([p, timeout]);
    clearTimeout(to);
    return res;
  } catch (err) {
    clearTimeout(to);
    throw err;
  }
}

export async function retry(fn, { retries = 2, baseMs = 800, factor = 1.8, jitter = true } = {}) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries) throw err;
      const wait = Math.round(
        baseMs * Math.pow(factor, attempt) * (jitter ? 0.7 + Math.random() * 0.6 : 1)
      );
      await sleep(wait);
      attempt++;
    }
  }
}
