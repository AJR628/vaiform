import admin from '../config/firebase.js'

const db = admin.firestore()

export async function ensureUserDocByUid(uid, email = null) {
  if (!uid) {
    throw new Error('ensureUserDocByUid requires uid')
  }

  const userRef = db.collection('users').doc(uid)
  const now = admin.firestore.FieldValue.serverTimestamp()

  const patch = {
    uid,
    updatedAt: now,
  }

  if (email !== undefined) {
    patch.email = email ?? null
  }

  const snap = await userRef.get()
  if (!snap.exists) {
    patch.createdAt = now
  }

  await userRef.set(patch, { merge: true })

  const finalSnap = await userRef.get()
  return {
    ref: userRef,
    data: finalSnap.data() || {},
  }
}

export default {
  ensureUserDocByUid,
}
