// src/services/user.service.js
import admin from '../config/firebase.js';

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

  // ✅ Create user doc without plan/credits/membership fields (pricing system handles these)
  const userDoc = {
    uid,
    email: email || null,
    shortDayKey: dayKey,
    shortCountToday: 0,
    createdAt: now,
    updatedAt: now,
  };

  // Use merge to avoid overwriting existing data
  await userRef.set(userDoc, { merge: true });

  console.log(`[user] User ensured: ${uid} (${email})`);
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

/**
 * Increment free shorts counter for a user (only if user is still Free)
 * Called after a successful short render to track lifetime usage.
 * @param {string} uid - User ID
 * @returns {Promise<number>} New count after increment (or current count if user is paid)
 */
export async function incrementFreeShortsUsed(uid) {
  if (!uid) {
    console.warn('[user.service] incrementFreeShortsUsed called without uid');
    return 0;
  }

  const db = admin.firestore();
  const userRef = db.collection('users').doc(uid);

  try {
    // Fetch current user data
    const snap = await userRef.get();
    if (!snap.exists) {
      console.warn(`[user.service] User document not found: ${uid}`);
      return 0;
    }

    const doc = snap.data() || {};

    // Check if user is still Free (same logic as middleware)
    const isMember = doc.isMember === true;
    const credits = doc.credits || 0;
    const subscriptionStatus = doc.subscriptionStatus;
    const isPaid = isMember || credits > 0 || subscriptionStatus === 'active';

    // If user is paid, don't increment free counter
    if (isPaid) {
      console.log(`[user.service] User ${uid} is paid, skipping freeShortsUsed increment`);
      return doc.freeShortsUsed || 0;
    }

    // User is Free - atomically increment counter
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
    // Don't throw - this is a tracking operation, shouldn't break the render flow
    // Try to get current count from a fresh read if possible, otherwise return 0
    try {
      const snap = await userRef.get();
      return snap.exists ? snap.data()?.freeShortsUsed || 0 : 0;
    } catch {
      return 0;
    }
  }
}
