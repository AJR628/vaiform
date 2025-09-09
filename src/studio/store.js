const _mem = new Map();

export function createStudio(id) {
  const now = Date.now();
  const doc = { id, createdAt: now, updatedAt: now, last: {} };
  _mem.set(id, doc);
  return doc;
}

export function getStudio(id) {
  return _mem.get(id) || null;
}

// used by UI list; return most recent first
export function listRecent(limit = 10) {
  return Array.from(_mem.values())
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, limit);
}

// convenience: returns studio, creating if missing
export function getOrCreate(id) {
  const found = getStudio(id);
  return found ?? createStudio(id);
}

// optional update helper
export function touch(id, data = {}) {
  const s = getOrCreate(id);
  Object.assign(s, data);
  s.updatedAt = Date.now();
  _mem.set(id, s);
  return s;
}

export default { createStudio, getStudio, listRecent, getOrCreate, touch };


