let activeRenders = 0;
const MAX_CONCURRENT_RENDERS = 3;

/**
 * Acquire a render slot. Throws if limit exceeded.
 * Note: Limit is per-process (single server deployment).
 * For multi-process scaling, use distributed locking / job queue (P2).
 */
export async function withRenderSlot(fn) {
  if (activeRenders >= MAX_CONCURRENT_RENDERS) {
    const err = new Error("SERVER_BUSY");
    err.code = "SERVER_BUSY";
    throw err;
  }

  activeRenders++;
  try {
    return await fn();
  } finally {
    activeRenders--;
  }
}

