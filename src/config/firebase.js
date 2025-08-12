// src/config/firebase.js
import admin from "firebase-admin";
import { readFile } from "fs/promises";

async function getCredential() {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "firebase-service-account.json";
  try {
    const json = await readFile(path, "utf-8");
    const sa = JSON.parse(json);
    return { cred: admin.credential.cert(sa), projectId: sa.project_id };
  } catch (_) {}

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    return { cred: admin.credential.cert(sa), projectId: sa.project_id };
  }

  return { cred: admin.credential.applicationDefault(), projectId: process.env.GCLOUD_PROJECT || null };
}

const { cred, projectId } = await getCredential();

// IMPORTANT: resolve bucket name
const resolvedBucketName =
  process.env.FIREBASE_STORAGE_BUCKET ||
  process.env.FIREBASE_BUCKET ||
  (projectId ? `${projectId}.appspot.com` : null);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: cred,
    ...(resolvedBucketName ? { storageBucket: resolvedBucketName } : {}),
  });
}

// Explicitly pass the name to avoid "no default bucket" error
const db = admin.firestore();
const bucket = admin.storage().bucket(resolvedBucketName || undefined);

console.log("🔥 Firestore project:", projectId || "(unknown)");
console.log("🔥 Storage bucket (resolved):", resolvedBucketName || "(none)");

export { admin, db, bucket };
