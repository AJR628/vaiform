import { EventEmitter } from 'node:events';

// Global singleton bus for studio event streaming
export const bus = globalThis.__vaiform_bus || (globalThis.__vaiform_bus = new EventEmitter());

export function sendEvent(studioId, event, data = {}) {
  try {
    bus.emit(studioId, { event, ts: Date.now(), ...data });
  } catch {}
}

export default { bus, sendEvent };
