// src/controllers/health.controller.js
import admin from 'firebase-admin';
import { db, bucket } from '../config/firebase.js';
// If your env file exports an OpenAI client, keep this import.
// Otherwise you can conditionally skip OpenAI checks in CI.
import { openai } from '../config/env.js';

export const root = (_req, res) => res.json({ ok: true, message: 'Vaiform backend is running 🚀' });

// A richer diagnostic endpoint.
// In CI (NODE_ENV=test), keep it quick and avoid external calls.
export const healthz = async (_req, res) => {
  const isCI = process.env.NODE_ENV === 'test';

  const checks = {
    env: {
      replicateKey: !!process.env.REPLICATE_API_TOKEN,
      stripeKey: !!process.env.STRIPE_SECRET_KEY,
      openaiKey: !!process.env.OPENAI_API_KEY,
      firebaseServiceAccountLoaded: !!admin.apps.length,
    },
    firestore: isCI ? 'skipped (CI)' : null,
    storage: isCI ? 'skipped (CI)' : null,
    openai: isCI ? 'skipped (CI)' : null,
    replicate: process.env.REPLICATE_API_TOKEN ? 'configured' : 'no_key',
  };

  if (!isCI) {
    try {
      // light touch read
      await db.collection('healthcheck').doc('ping').get();
      checks.firestore = 'ok';
    } catch (e) {
      checks.firestore = `error: ${e.message}`;
    }

    try {
      // list at most 1 file to confirm bucket wiring
      await bucket.getFiles({ maxResults: 1 });
      checks.storage = 'ok';
    } catch (e) {
      checks.storage = `error: ${e.message}`;
    }

    try {
      if (process.env.OPENAI_API_KEY && openai?.models?.list) {
        await openai.models.list();
        checks.openai = 'ok';
      } else {
        checks.openai = process.env.OPENAI_API_KEY ? 'client_missing' : 'no_key';
      }
    } catch (e) {
      checks.openai = `error: ${e.message}`;
    }
  }

  const failures = Object.values(checks).filter(
    (v) => typeof v === 'string' && v.startsWith('error')
  ).length;

  res
    .status(failures ? 207 : 200)
    .json({ status: failures ? 'degraded' : 'ok', now: new Date().toISOString(), checks });
};

export const version = (_req, res) =>
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    node: process.version,
    environment: process.env.NODE_ENV || 'development',
    replicateKey: !!process.env.REPLICATE_API_TOKEN,
    stripeKey: !!process.env.STRIPE_SECRET_KEY,
    openaiKey: !!process.env.OPENAI_API_KEY,
    firebaseConfigured: !!admin.apps.length,
    commit: process.env.COMMIT_SHA || process.env.GITHUB_SHA || 'dev',
  });

// Avoid writes in CI. Use only for manual/local diagnostics.
export const testFirestore = async (_req, res) => {
  if (process.env.NODE_ENV === 'test') {
    return res.json({ success: true, skipped: true, reason: 'CI/test mode' });
  }
  try {
    const testRef = db.collection('users').doc('test@example.com');
    await testRef.set({ hello: 'world' });
    const snap = await testRef.get();
    res.json({ success: true, data: snap.data() });
  } catch (err) {
    console.error('🔥 Firestore test failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const register = async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Missing email.' });

  try {
    const userRef = db.collection('users').doc(email);
    const docSnap = await userRef.get();

    if (docSnap.exists) {
      return res.json({ success: true, message: 'User already exists.' });
    }

    await userRef.set({
      credits: 50,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, message: 'New user created with 50 credits.' });
  } catch (err) {
    console.error('❌ Error in /register:', err.message);
    res.status(500).json({ success: false, error: 'Registration failed.' });
  }
};
