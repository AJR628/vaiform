const mem = new Map();

export function ensure(id) {
  const key = String(id || '').trim();
  if (!key) return null;
  if (!mem.has(key)) {
    mem.set(key, { id: key, createdAt: Date.now() });
  }
  return mem.get(key);
}

export function get(id) {
  return mem.get(String(id || '').trim()) || null;
}

export function has(id) {
  return mem.has(String(id || '').trim());
}

export function dump() {
  return Object.fromEntries(mem.entries());
}

export default { ensure, get, has, dump };


