// src/services/user.service.js
import admin from '../config/firebase.js';
import { buildCanonicalUsageState } from './usage.service.js';

/**
 * Ensure user document exists with free non-billing defaults.
 * Billing entitlement/usage state is owned by usage.service.
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
    shortDayKey: dayKey,
    shortCountToday: 0,
    createdAt: now,
    updatedAt: now,
  };

  await userRef.set(userDoc, { merge: true });

  console.log(`[user] User ensured: ${uid} (${email})`);
  return { ref: userRef, data: userDoc };
}

/**
 * Get user data from Firestore.
 */
export async function getUserData(uid) {
  if (!uid) return null;

  const db = admin.firestore();
  const userRef = db.collection('users').doc(uid);
  const snap = await userRef.get();

  if (!snap.exists) return null;
  return snap.data() || {};
}

/**
 * Increment free shorts counter for a user (only while plan is free).
 */
export async function incrementFreeShortsUsed(uid) {
  if (!uid) {
    console.warn('[user.service] incrementFreeShortsUsed called without uid');
    return 0;
  }

  const db = admin.firestore();
  const userRef = db.collection('users').doc(uid);

  try {
    const snap = await userRef.get();
    if (!snap.exists) {
      console.warn(`[user.service] User document not found: ${uid}`);
      return 0;
    }

    const doc = snap.data() || {};
    const accountState = buildCanonicalUsageState(doc);
    if (accountState.plan !== 'free') {
      console.log(`[user.service] User ${uid} is paid, skipping freeShortsUsed increment`);
      return doc.freeShortsUsed || 0;
    }

    const currentCount = doc.freeShortsUsed || 0;
    await userRef.update({
      freeShortsUsed: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const newCount = currentCount + 1;
    console.log(
      `[user.service] Incremented freeShortsUsed for ${uid}: ${currentCount} -> ${newCount}`
    );
    return newCount;
  } catch (error) {
    console.error(`[user.service] Failed to increment freeShortsUsed for ${uid}:`, error);
    try {
      const snap = await userRef.get();
      return snap.exists ? snap.data()?.freeShortsUsed || 0 : 0;
    } catch {
      return 0;
    }
  }
}
