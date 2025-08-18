// src/config/firebase.js
import admin from "firebase-admin";

const {
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
  FIREBASE_STORAGE_BUCKET,
} = process.env;

// Handle \n in PRIVATE_KEY secrets
const privateKey = FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
    // MUST be the bare bucket name (no gs:// prefix)
    storageBucket: FIREBASE_STORAGE_BUCKET,
  });
}

// Singletons
const db = admin.firestore();
const bucket = admin.storage().bucket();

// Helpful boot logs
try {
  console.log("🔥 Firestore project:", FIREBASE_PROJECT_ID);
  console.log("🔥 Storage bucket (resolved):", bucket.name);
} catch (e) {
  console.error("❌ Firebase init/log error:", e?.message || e);
}

export { db, bucket };
export default admin;