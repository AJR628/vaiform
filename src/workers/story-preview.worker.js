import logger from '../observability/logger.js';
import {
  createStoryPreviewRunner,
  ensureStoryPreviewRunner,
  stopStoryPreviewRunner,
} from '../services/story-preview.runner.js';

const WORKER_RUNTIME_KEY = Symbol.for('vaiform.storyPreviewWorkerRuntime');

export function startStoryPreviewWorkerRuntime({ installSignalHandlers = false } = {}) {
  if (globalThis[WORKER_RUNTIME_KEY]) {
    return globalThis[WORKER_RUNTIME_KEY];
  }

  const runner = ensureStoryPreviewRunner({ keepProcessAlive: true });
  let signalHandlersInstalled = false;

  const stop = (signal = 'manual') => {
    if (!globalThis[WORKER_RUNTIME_KEY]) return;
    stopStoryPreviewRunner();
    logger.info('story.preview.worker_runtime.stopped', {
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

  logger.info('story.preview.worker_runtime.started', {
    runnerId: runner.runnerId,
    signalHandlersInstalled,
  });
  globalThis[WORKER_RUNTIME_KEY] = runtime;
  return runtime;
}

export function startIsolatedStoryPreviewWorkerRuntime({
  installSignalHandlers = false,
  runtimeLabel = 'isolated',
} = {}) {
  const runner = createStoryPreviewRunner({ keepProcessAlive: true });
  let stopped = false;
  let signalHandlersInstalled = false;

  const stop = (signal = 'manual') => {
    if (stopped) return;
    stopped = true;
    runner.stop();
    logger.info('story.preview.worker_runtime.stopped', {
      runnerId: runner.runnerId,
      signal,
      runtimeLabel,
      isolated: true,
    });
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

  logger.info('story.preview.worker_runtime.started', {
    runnerId: runner.runnerId,
    signalHandlersInstalled,
    runtimeLabel,
    isolated: true,
  });

  return {
    runnerId: runner.runnerId,
    stop,
  };
}

export function stopStoryPreviewWorkerRuntime(signal = 'manual') {
  globalThis[WORKER_RUNTIME_KEY]?.stop?.(signal);
}
