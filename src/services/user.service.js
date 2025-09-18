// src/services/user.service.js
import admin from "../config/firebase.js";

/**
 * Ensure user document exists with free plan setup
 * Called after Firebase Auth sign-in to create/update user doc
 */
export async function ensureFreeUser(uid, email) {
  if (!uid) throw new Error('ensureFreeUser requires uid');
  
  const db = admin.firestore();
  const userRef = db.collection('users').doc(uid);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const dayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  
  const userDoc = {
    uid,
    email: email || null,
    plan: 'free',
    isMember: false,
    credits: 0,
    shortDayKey: dayKey,
    shortCountToday: 0,
    createdAt: now,
    updatedAt: now,
  };
  
  // Use merge to avoid overwriting existing data
  await userRef.set(userDoc, { merge: true });
  
  console.log(`[user] Free user ensured: ${uid} (${email})`);
  return { ref: userRef, data: userDoc };
}

/**
 * Get user data with membership status
 */
export async function getUserData(uid) {
  if (!uid) return null;
  
  const db = admin.firestore();
  const userRef = db.collection('users').doc(uid);
  const snap = await userRef.get();
  
  if (!snap.exists) return null;
  
  const data = snap.data() || {};
  
  // Check if one-time membership has expired
  if (data.membership?.kind === 'onetime' && data.membership?.expiresAt) {
    if (Date.now() > data.membership.expiresAt) {
      // Update expired membership
      await userRef.update({
        isMember: false,
        'membership.expired': true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      data.isMember = false;
      data.membership.expired = true;
    }
  }
  
  return data;
}
