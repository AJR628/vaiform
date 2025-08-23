// src/config/firebase.js
import admin from "firebase-admin";

// ---- Choose credential ----
// Prefer GOOGLE_APPLICATION_CREDENTIALS on Replit if set.
// Falls back to applicationDefault (works on Replit if env var is set in Secrets).
const credential =
  process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? admin.credential.applicationDefault()
    : admin.credential.applicationDefault(); // keep simple; both paths use ADC

// ---- Storage bucket ----
// If your Firebase project ID is "vaiform", the default bucket is "vaiform.appspot.com".
const STORAGE_BUCKET =
  process.env.FB_STORAGE_BUCKET?.trim() || "vaiform.appspot.com";

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential,
      storageBucket: STORAGE_BUCKET,
      projectId: "vaiform"
    });
    // Helpful boot log
    console.log(
      `🔥 Firebase Admin initialized (bucket=${STORAGE_BUCKET}, projectId=vaiform)`
    );
  } catch (error) {
    console.error("🔥 Firebase Admin initialization failed:", error.message);
    // Continue without Firebase for development/testing
  }
}

// Expose shared handles
export const db = admin.firestore();
export const bucket = admin.storage().bucket();
export default admin;
