import crypto from "node:crypto";

// True singleton via global symbol
const key = Symbol.for('vaiform.studio.store');
const g = globalThis[key] || (globalThis[key] = { map: new Map(), id: Math.random().toString(36).slice(2) });

export const STORE_INSTANCE_ID = g.id;

export function getStudio(id){
  if (!id) return null;
  return g.map.get(id) || null;
}

export function createStudio(init = {}){
  const s = {
    id: init?.id ?? `std-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
    createdAt: Date.now(),
    status: 'new',
    tracks: {},
    ...init,
  };
  g.map.set(s.id, s);
  console.log('[studio][create]', JSON.stringify({ id: s.id }));
  return s;
}

export function upsertStudio(patch){
  if (!patch?.id) throw new Error('MISSING_ID');
  const cur = g.map.get(patch.id) || { id: patch.id, createdAt: Date.now(), status:'new', tracks:{} };
  const next = { ...cur, ...patch, tracks: { ...cur.tracks, ...(patch.tracks || {}) } };
  g.map.set(next.id, next);
  return next;
}

export function setStatus(id, status){
  const cur = getStudio(id);
  if (!cur) return null;
  cur.status = status;
  g.map.set(id, cur);
  return cur;
}

export function listStudios(n=20){
  return Array.from(g.map.values()).slice(-n).reverse().map(({id,status,createdAt})=>({id,status,createdAt}));
}

export default { STORE_INSTANCE_ID, getStudio, createStudio, upsertStudio, setStatus, listStudios };


