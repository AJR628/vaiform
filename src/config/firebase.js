// src/config/firebase.js
import admin from 'firebase-admin';

/** Coerce multiline private keys from env (handles \n and stray quotes) */
function coercePrivateKey(pk) {
  if (!pk) return pk;
  if (pk.startsWith('"') && pk.endsWith('"')) {
    try {
      pk = JSON.parse(pk);
    } catch {
      /* ignore */
    }
  }
  return pk.replace(/\\n/g, '\n');
}

function getCredentialFromEnv() {
  // Option A: full JSON in base64 (FIREBASE_SERVICE_ACCOUNT_B64)
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (b64) {
    try {
      const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      return { cred: admin.credential.cert(json), type: 'service-account' };
    } catch (e) {
      console.error('⚠️ Could not parse FIREBASE_SERVICE_ACCOUNT_B64:', e.message);
    }
  }

  // Option B: split vars (PROJECT_ID, CLIENT_EMAIL, PRIVATE_KEY)
  const projectId = process.env.FIREBASE_PROJECT_ID || 'vaiform';
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = coercePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (clientEmail && privateKey) {
    return {
      cred: admin.credential.cert({ projectId, clientEmail, privateKey }),
      type: 'service-account',
    };
  }

  // Last resort (GCP only) — not correct for Replit
  console.warn('⚠️ Falling back to applicationDefault() (GCP metadata).');
  return { cred: admin.credential.applicationDefault(), type: 'adc' };
}

if (!admin.apps.length) {
  const { cred, type } = getCredentialFromEnv();

  const projectId = process.env.FIREBASE_PROJECT_ID || 'vaiform';
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET?.trim() || 'vaiform.appspot.com';

  admin.initializeApp({
    credential: cred,
    projectId,
    storageBucket,
  });

  console.log(
    `🔥 Firebase Admin initialized (bucket=${storageBucket}, projectId=${projectId}, cred=${type})`
  );
  try {
    const name = admin.storage().bucket().name;
    console.log('[boot] Firebase Storage bucket:', name);
  } catch (e) {
    console.warn('[boot] could not read storage bucket name', e?.message || e);
  }
}

// Shared handles
export const db = admin.firestore();
export const bucket = admin.storage().bucket();
export default admin;
