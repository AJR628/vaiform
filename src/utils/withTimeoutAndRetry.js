// src/utils/withTimeoutAndRetry.js

/**
 * Run a function with timeout + retry support.
 *
 * @param {Function} fn - async function to run
 * @param {Object} opts
 * @param {number} opts.timeoutMs - max time per attempt
 * @param {number} opts.retries   - number of retries after the first attempt
 */
export async function withTimeoutAndRetry(fn, { timeoutMs = 20000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await Promise.race([
        fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        console.warn(`⚠️ Attempt ${attempt + 1} failed, retrying...`, err.message);
        await new Promise((r) => setTimeout(r, 300)); // small backoff
        continue;
      }
    }
  }
  throw lastErr;
}
