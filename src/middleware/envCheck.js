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
    'OPENAI_API_KEY',
    'STRIPE_SECRET_KEY',
    'REPLICATE_API_TOKEN',
  ];

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('❌ Missing env vars:', missing.join(', '));
    process.exit(1);
  }

  console.log('✅ envCheck passed');
}
