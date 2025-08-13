// src/config/firebase.js
import admin from 'firebase-admin';

// Initialize Admin SDK once per process without try/catch noise
if (!admin.apps.length) {
  admin.initializeApp({
    // If running on GCP with a service account, applicationDefault() is fine.
    // If using a JSON service account, ensure GOOGLE_APPLICATION_CREDENTIALS is set,
    // or load from env and pass credential here.
    // credential: admin.credential.applicationDefault(),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'vaiform',
    projectId: process.env.FIREBASE_PROJECT_ID || 'vaiform',
  });
}

// Handy exports (optional, but nice for imports elsewhere)
export const db = admin.firestore();
export const bucket = admin.storage().bucket();

export default admin;
