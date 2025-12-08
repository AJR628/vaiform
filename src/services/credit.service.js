// src/services/credit.service.js
import admin from 'firebase-admin';
import { db } from '../config/firebase.js';

/** ---------- helpers ---------- */
const normEmail = (e) => (e || '').trim().toLowerCase();
const isEmailStr = (s) => typeof s === 'string' && s.includes('@');

async function copySubcollection(srcRef, dstRef, name) {
  const snap = await srcRef.collection(name).get();
  if (snap.empty) return;
  for (const doc of snap.docs) {
    await dstRef.collection(name).doc(doc.id).set(
      { ...doc.data(), note: 'migrated_from_email_doc' },
      { merge: true }
    );
    // delete the legacy doc after copying to keep things tidy
    await doc.ref.delete().catch(() => {});
  }
}

/** -------- Pricing / Stripe helpers (back-compat) --------
 * Expose CREDIT_PRICE_MAP so webhook.controller.js keeps working.
 * You can define price→credits via env:
 *   STRIPE_PRICE_SMALL, STRIPE_PRICE_MEDIUM, STRIPE_PRICE_LARGE (IDs) and fixed credits below
 *   or STRIPE_PRICE_MAP='{"price_123":50,"price_abc":120}'
 */
export const CREDIT_PRICE_MAP = (() => {
  const map = {};

  // Common three-tier pattern (override IDs via env)
  const tiers = [
    ['STRIPE_PRICE_SMALL', 50],
    ['STRIPE_PRICE_MEDIUM', 120],
    ['STRIPE_PRICE_LARGE', 300],
  ];
  for (const [envKey, credits] of tiers) {
    const priceId = process.env[envKey];
    if (priceId) map[priceId] = credits;
  }

  // Optional JSON map for arbitrary prices
  try {
    const extra = process.env.STRIPE_PRICE_MAP ? JSON.parse(process.env.STRIPE_PRICE_MAP) : {};
    for (const [priceId, credits] of Object.entries(extra || {})) {
      const n = Number(credits);
      if (priceId && Number.isFinite(n) && n > 0) map[priceId] = Math.floor(n);
    }
  } catch {
    /* ignore malformed JSON */
  }

  return map;
})();

export function getCreditsForStripePrice(priceId) {
  return CREDIT_PRICE_MAP[priceId] ?? 0;
}

/** -------- Plan → Credits mapping --------
 * Maps plan names to credit amounts granted on purchase.
 */
export const PLAN_CREDITS_MAP = {
  creator: 2500,
  pro: 5000,
};

export function getCreditsForPlan(planName) {
  return PLAN_CREDITS_MAP[planName] ?? 0;
}

/** -------- Render credit cost -------- */
export const RENDER_CREDIT_COST = 20;

/** -------- Core pricing used by generators -------- */
export function computeCost(n = 1) {
  // Adjust if your pricing differs
  return Math.max(1, Math.floor(n)) * 5;
}

/** -------- Canonical user doc: /users/{uid} with auto-migration --------
 * Ensures /users/{uid} exists. If a legacy /users/{email} doc exists,
 * migrates its credits + subcollections into the UID doc and deletes the legacy root.
 */
export async function ensureUserDocByUid(uid, email) {
  if (!uid) throw new Error('ensureUserDocByUid requires uid');

  const users = db.collection('users');
  const uidRef = users.doc(uid);
  const now = admin.firestore.FieldValue.serverTimestamp();

  let uidSnap = await uidRef.get();
  if (!uidSnap.exists) {
    // ✅ Create user doc without credits/plan/membership fields (pricing system handles these)
    await uidRef.set(
      {
        email: email || null,
        uid,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
    uidSnap = await uidRef.get();
  } else if (email && (uidSnap.data()?.email !== email)) {
    await uidRef.set({ email, updatedAt: now }, { merge: true });
  }

  // If we have an email, migrate legacy /users/{email} → /users/{uid}
  if (email) {
    const emailId = normEmail(email);
    const legacyRef = users.doc(emailId);
    const legacySnap = await legacyRef.get();

    if (legacySnap.exists) {
      const legacy = legacySnap.data() || {};
      const legacyCredits = Number(legacy.credits || 0);

      // Move numeric credits atomically
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(uidRef);
        const currentCredits = Number((fresh.data() || {}).credits || 0);
        tx.update(uidRef, {
          credits: currentCredits + legacyCredits,
          email: emailId, // keep canonical email
          uid,
          updatedAt: now,
        });
        // Do NOT delete legacyRef in txn (we need to copy subcollections first)
      });

      // Copy subcollections, then delete legacy root
      await Promise.all([
        copySubcollection(legacyRef, uidRef, 'transactions').catch(() => {}),
        copySubcollection(legacyRef, uidRef, 'generations').catch(() => {}),
      ]);

      await legacyRef.delete().catch(() => {});
      console.log(`🧹 Migrated legacy user doc "${emailId}" → uid "${uid}"`);
    }
  }

  return { ref: uidRef, data: uidSnap.data() };
}

/** -------- Back-compat shim (more flexible) --------
 * Accepts:
 *   - (email)                      → resolves UID via Admin Auth, else uses /users/{email} temp
 *   - (email, uidHint)             → prefers UID doc and migrates legacy email doc
 *   - (uid, email)                 → ensures UID doc, assigns email, migrates legacy email doc
 *   - (uid)                        → ensures UID doc (no email)
 */
export async function ensureUserDoc(arg1, arg2) {
  if (!arg1) throw new Error('ensureUserDoc requires uid or email');

  // Case A: first arg is email
  if (isEmailStr(arg1)) {
    const email = normEmail(arg1);
    const uidHint = arg2 && !isEmailStr(arg2) ? String(arg2) : null;

    // If we have a UID hint, go straight to UID canonical path (and migrate)
    if (uidHint) return ensureUserDocByUid(uidHint, email);

    // Otherwise, try to resolve UID from Auth; fall back to legacy email doc
    try {
      const rec = await admin.auth().getUserByEmail(email);
      if (rec?.uid) return ensureUserDocByUid(rec.uid, email);
    } catch {
      // No Auth user yet; continue to legacy email doc
    }

    // Create/return legacy /users/{email} as a temporary home
    const ref = db.collection('users').doc(email);
    const snap = await ref.get();
    if (!snap.exists) {
      // ✅ Create legacy doc without credits field (pricing system handles these)
      await ref.set(
        {
          email,
          uid: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return { ref, data: { email, uid: null } };
    }
    return { ref, data: snap.data() || { email, uid: null } };
  }

  // Case B: first arg is UID (second may be email)
  const uid = String(arg1);
  const email = arg2 && isEmailStr(arg2) ? normEmail(arg2) : null;
  return ensureUserDocByUid(uid, email);
}

/** -------- Atomic debit / refund -------- */
export async function debitCreditsTx(uid, amount) {
  return db.runTransaction(async (tx) => {
    const userRef = db.collection('users').doc(uid);
    const snap = await tx.get(userRef);
    const credits = snap.data()?.credits ?? 0;
    if (credits < amount) {
      const err = new Error('Insufficient credits');
      err.code = 'INSUFFICIENT_CREDITS';
      err.status = 400;
      throw err;
    }
    tx.update(userRef, { credits: admin.firestore.FieldValue.increment(-amount) });
    return { userRef, before: credits, after: credits - amount };
  });
}

export async function refundCredits(uid, amount) {
  await db.collection('users').doc(uid)
    .update({ credits: admin.firestore.FieldValue.increment(amount) });
}

/**
 * Spend credits for a render operation
 * Uses Firestore transaction to atomically check and deduct credits
 * @param {string} uid - User ID
 * @param {number} amount - Amount of credits to spend
 * @throws {Error} USER_NOT_FOUND if user doc doesn't exist
 * @throws {Error} INSUFFICIENT_CREDITS if credits < amount
 */
export async function spendCredits(uid, amount) {
  if (!uid) {
    const err = new Error('User ID required');
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  return db.runTransaction(async (tx) => {
    const userRef = db.collection('users').doc(uid);
    const snap = await tx.get(userRef);
    
    if (!snap.exists) {
      const err = new Error('User not found');
      err.code = 'USER_NOT_FOUND';
      throw err;
    }

    const doc = snap.data() || {};
    const credits = doc.credits || 0;

    if (credits < amount) {
      const err = new Error('Insufficient credits');
      err.code = 'INSUFFICIENT_CREDITS';
      throw err;
    }

    tx.update(userRef, {
      credits: admin.firestore.FieldValue.increment(-amount),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { before: credits, after: credits - amount };
  });
}
