// src/config/firebase.js
import admin from 'firebase-admin';
import { readFile } from 'fs/promises';

function parseMaybeBase64(jsonish) {
  if (!jsonish) return null;
  const text = jsonish.trim().startsWith('{')
    ? jsonish
    : Buffer.from(jsonish, 'base64').toString('utf8');
  const obj = JSON.parse(text);
  if (obj.private_key?.includes('\\n')) {
    obj.private_key = obj.private_key.replace(/\\n/g, '\n');
  }
  return obj;
}

async function getCredential() {
  // 1) Path on disk (optional)
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 'firebase-service-account.json';
  try {
    const json = await readFile(path, 'utf-8');
    const sa = JSON.parse(json);
    return { cred: admin.credential.cert(sa), projectId: sa.project_id };
  } catch (_) {}

  // 2) Single env var (raw or base64 JSON) — RECOMMENDED
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const sa = parseMaybeBase64(process.env.FIREBASE_SERVICE_ACCOUNT);
    return { cred: admin.credential.cert(sa), projectId: sa.project_id };
  }

  // 3) Fallback (may not work on Replit for verification)
  return {
    cred: admin.credential.applicationDefault(),
    projectId: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || null,
  };
}

const { cred, projectId } = await getCredential();

const resolvedBucketName =
  process.env.FIREBASE_STORAGE_BUCKET || // Prefer explicit, e.g. "vaiform.appspot.com"
  process.env.FIREBASE_BUCKET ||
  (projectId ? `${projectId}.appspot.com` : null);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: cred,
    projectId: projectId || process.env.FIREBASE_PROJECT_ID || undefined,
    storageBucket: resolvedBucketName || undefined,
  });
}

export const db = admin.firestore();
export const bucket = admin.storage().bucket(resolvedBucketName || undefined);
export default admin; // 👈 so middleware can import the initialized Admin

console.log('🔥 Firestore project:', projectId || '(unknown)');
console.log('🔥 Storage bucket (resolved):', resolvedBucketName || '(none)');
