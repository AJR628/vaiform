// src/middleware/envCheck.js
import { listMonthlyPlanConfigs } from '../config/commerce.js';

function hasNonEmptyEnv(name) {
  return typeof process.env[name] === 'string' && process.env[name].trim().length > 0;
}

function exitWithMissing(message, missing = []) {
  const suffix = Array.isArray(missing) && missing.length ? `: ${missing.join(', ')}` : '';
  console.error(`${message}${suffix}`);
  process.exit(1);
}

function hasFirebaseCredentials() {
  const hasB64 = hasNonEmptyEnv('FIREBASE_SERVICE_ACCOUNT_B64');
  const hasSplit = hasNonEmptyEnv('FIREBASE_CLIENT_EMAIL') && hasNonEmptyEnv('FIREBASE_PRIVATE_KEY');
  return hasB64 || hasSplit;
}

function strictPaidBetaEnvNames() {
  const required = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'OPENAI_API_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'FRONTEND_URL',
    ...listMonthlyPlanConfigs().map((plan) => plan.stripePriceEnvKey),
  ];

  const ttsProvider = (process.env.TTS_PROVIDER || 'openai').trim().toLowerCase();
  if (ttsProvider === 'elevenlabs') {
    required.push('ELEVENLABS_API_KEY');
  }

  return [...new Set(required)];
}

export default function envCheck() {
  if (process.env.NODE_ENV === 'test') {
    console.log('envCheck: test mode, skipping strict checks');
    return;
  }

  const required = ['FIREBASE_PROJECT_ID', 'FIREBASE_STORAGE_BUCKET'];
  const optional = ['OPENAI_API_KEY', 'STRIPE_SECRET_KEY', 'REPLICATE_API_TOKEN'];
  const strictMode = process.env.PAID_BETA_STRICT_ENV === '1';

  if (!hasFirebaseCredentials()) {
    exitWithMissing(
      'Missing Firebase credentials. Set FIREBASE_SERVICE_ACCOUNT_B64 or both FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY'
    );
  }

  const missing = required.filter((key) => !hasNonEmptyEnv(key));
  if (missing.length) {
    exitWithMissing('Missing required env vars', missing);
  }

  if (strictMode) {
    const missingStrict = strictPaidBetaEnvNames().filter((key) => !hasNonEmptyEnv(key));
    if (missingStrict.length) {
      exitWithMissing('Missing paid beta strict env vars', missingStrict);
    }
    console.log('envCheck passed in paid beta strict mode');
    return;
  }

  const missingOptional = optional.filter((key) => !hasNonEmptyEnv(key));
  if (missingOptional.length) {
    console.warn(
      'Missing optional env vars (some features disabled):',
      missingOptional.join(', ')
    );
  }

  console.log('envCheck passed');
}
