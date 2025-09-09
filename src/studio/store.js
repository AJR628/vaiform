import admin from "../config/firebase.js";

// Minimal studio doc shape
// { id, createdAt, updatedAt, status, tracks: { quote?:any, video?:any } }

const mem = new Map();

function nowIso(){ return new Date().toISOString(); }

function useFirestore(){
  return (process.env.PERSIST_STUDIOS === 'firestore') && !!admin?.firestore;
}

async function fsCol(){
  if (!useFirestore()) return null;
  const db = admin.firestore();
  return db.collection('studios');
}

export async function getStudio(id){
  if (!id) return null;
  if (useFirestore()) {
    try {
      const col = await fsCol();
      const doc = await col.doc(id).get();
      if (!doc.exists) return null;
      return doc.data();
    } catch { return null; }
  }
  return mem.get(id) || null;
}

export async function createStudio(init = {}){
  const id = String(init.id || `std-${Math.random().toString(36).slice(2,8)}${Date.now().toString(36)}`);
  const doc = {
    id,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    status: init.status || 'new',
    tracks: init.tracks || {},
  };
  if (useFirestore()) {
    const col = await fsCol();
    await col.doc(id).set(doc, { merge: true });
  } else {
    mem.set(id, doc);
  }
  console.log('[studio][create]', JSON.stringify({ id }));
  return doc;
}

export async function upsertStudio(doc){
  if (!doc?.id) throw new Error('MISSING_ID');
  const merged = { ...doc, updatedAt: nowIso() };
  if (useFirestore()) {
    const col = await fsCol();
    await col.doc(doc.id).set(merged, { merge: true });
  } else {
    mem.set(doc.id, merged);
  }
  return merged;
}

export async function setStatus(id, status){
  const cur = (await getStudio(id)) || { id, createdAt: nowIso(), tracks: {} };
  cur.status = status;
  cur.updatedAt = nowIso();
  await upsertStudio(cur);
  return cur;
}

export async function listRecent(limit = 20){
  if (useFirestore()) {
    const col = await fsCol();
    const snap = await col.orderBy('updatedAt', 'desc').limit(limit).get();
    return snap.docs.map(d => d.data());
  }
  return Array.from(mem.values()).sort((a,b)=>Date.parse(b.updatedAt||0)-Date.parse(a.updatedAt||0)).slice(0, limit);
}

export default { getStudio, createStudio, upsertStudio, setStatus, listRecent };


