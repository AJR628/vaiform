import logger from '../observability/logger.js';
import { ensureStoryFinalizeRunner, stopStoryFinalizeRunner } from '../services/story-finalize.runner.js';

const WORKER_RUNTIME_KEY = Symbol.for('vaiform.storyFinalizeWorkerRuntime');

export function startStoryFinalizeWorkerRuntime({ installSignalHandlers = false } = {}) {
  if (globalThis[WORKER_RUNTIME_KEY]) {
    return globalThis[WORKER_RUNTIME_KEY];
  }

  const runner = ensureStoryFinalizeRunner({ keepProcessAlive: true });
  let signalHandlersInstalled = false;

  const stop = (signal = 'manual') => {
    if (!globalThis[WORKER_RUNTIME_KEY]) return;
    stopStoryFinalizeRunner();
    logger.info('story.finalize.worker_runtime.stopped', {
      runnerId: runner.runnerId,
      signal,
    });
    delete globalThis[WORKER_RUNTIME_KEY];
  };

  const runtime = {
    runnerId: runner.runnerId,
    stop,
  };

  if (installSignalHandlers) {
    const handleSignal = (signal) => {
      stop(signal);
      process.exit(0);
    };
    process.once('SIGINT', () => handleSignal('SIGINT'));
    process.once('SIGTERM', () => handleSignal('SIGTERM'));
    signalHandlersInstalled = true;
  }

  logger.info('story.finalize.worker_runtime.started', {
    runnerId: runner.runnerId,
    signalHandlersInstalled,
  });
  globalThis[WORKER_RUNTIME_KEY] = runtime;
  return runtime;
}

export function stopStoryFinalizeWorkerRuntime(signal = 'manual') {
  globalThis[WORKER_RUNTIME_KEY]?.stop?.(signal);
}
