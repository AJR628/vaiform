// src/middleware/envCheck.js
export default function envCheck() {
  // In CI (Health Check workflow), we set NODE_ENV=test and dummy envs.
  if (process.env.NODE_ENV === 'test') {
    console.log('⚙️ envCheck: test mode (CI) — skipping strict checks');
    return;
  }

  const required = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
  ];

  // Firebase credentials: require either B64 JSON or split vars
  const hasB64 = !!process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  const hasSplit = !!(process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY);
  if (!hasB64 && !hasSplit) {
    console.error('❌ Missing Firebase credentials: set FIREBASE_SERVICE_ACCOUNT_B64 OR (FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY)');
    process.exit(1);
  }

  const optional = [
    'OPENAI_API_KEY',
    'STRIPE_SECRET_KEY', 
    'REPLICATE_API_TOKEN',
  ];

  const missing = required.filter((k) => !process.env[k]);
  const missingOptional = optional.filter((k) => !process.env[k]);
  
  if (missing.length) {
    console.error('❌ Missing required env vars:', missing.join(', '));
    process.exit(1);
  }
  
  if (missingOptional.length) {
    console.warn('⚠️ Missing optional env vars (some features disabled):', missingOptional.join(', '));
  }

  console.log('✅ envCheck passed');
}
