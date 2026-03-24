const OVERRIDES_KEY = Symbol.for('vaiform.test.runtimeOverrides');

function getStore() {
  if (!globalThis[OVERRIDES_KEY]) {
    globalThis[OVERRIDES_KEY] = new Map();
  }
  return globalThis[OVERRIDES_KEY];
}

export function getRuntimeOverride(name) {
  if (process.env.NODE_ENV !== 'test') return null;
  return getStore().get(name) || null;
}

export function setRuntimeOverride(name, fn) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('setRuntimeOverride requires a non-empty name');
  }
  if (typeof fn !== 'function') {
    throw new Error(`Runtime override "${name}" must be a function`);
  }
  getStore().set(name, fn);
}

export function clearRuntimeOverrides() {
  getStore().clear();
}

export default {
  getRuntimeOverride,
  setRuntimeOverride,
  clearRuntimeOverrides,
};
