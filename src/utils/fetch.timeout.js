/**
 * Execute an async operation with AbortController timeout covering the entire operation
 * @param {Function} run - Async function that receives signal and performs fetch + body consumption
 * @param {Object} opts
 * @param {number} opts.timeoutMs - Timeout in milliseconds
 * @param {string} opts.errorMessage - Exact error message to throw on timeout
 * @returns {Promise} - Result of run(signal)
 */
export async function withAbortTimeout(run, { timeoutMs, errorMessage } = {}) {
  if (!timeoutMs || timeoutMs <= 0) {
    return run(null); // No timeout, no signal
  }

  if (!errorMessage) {
    throw new Error('withAbortTimeout: errorMessage is required');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await run(controller.signal);
    clearTimeout(timeoutId);
    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      const error = new Error(errorMessage);
      error.code = errorMessage;
      error.timeoutMs = timeoutMs;
      throw error;
    }
    throw err;
  }
}

