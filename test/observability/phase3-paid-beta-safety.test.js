import assert from 'node:assert/strict';
import test from 'node:test';

import envCheck from '../../src/middleware/envCheck.js';
import errorHandler from '../../src/middleware/error.middleware.js';

function withEnv(patch) {
  const previous = new Map();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

function baseStrictEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    PAID_BETA_STRICT_ENV: '1',
    FIREBASE_PROJECT_ID: 'vaiform-test',
    FIREBASE_STORAGE_BUCKET: 'vaiform-test.appspot.com',
    FIREBASE_CLIENT_EMAIL: 'svc@example.com',
    FIREBASE_PRIVATE_KEY: 'test-private-key',
    OPENAI_API_KEY: 'openai-test-key',
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_WEBHOOK_SECRET: 'whsec_123',
    FRONTEND_URL: 'https://vaiform.example.com',
    STRIPE_PRICE_CREATOR_SUB: 'price_creator',
    STRIPE_PRICE_PRO_SUB: 'price_pro',
    ...overrides,
  };
}

function expectExit(fn) {
  const originalExit = process.exit;
  const originalError = console.error;
  const messages = [];
  let exitCode = null;

  process.exit = (code) => {
    exitCode = code;
    throw new Error(`process.exit:${code}`);
  };
  console.error = (...args) => {
    messages.push(args.join(' '));
  };

  try {
    assert.throws(() => fn(), /process\.exit:1/);
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }

  return {
    exitCode,
    output: messages.join('\n'),
  };
}

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('envCheck skips strict validation in test mode', () => {
  const restoreEnv = withEnv({
    NODE_ENV: 'test',
    PAID_BETA_STRICT_ENV: '1',
    FIREBASE_PROJECT_ID: null,
    FIREBASE_STORAGE_BUCKET: null,
    FIREBASE_SERVICE_ACCOUNT_B64: null,
    FIREBASE_CLIENT_EMAIL: null,
    FIREBASE_PRIVATE_KEY: null,
    OPENAI_API_KEY: null,
    STRIPE_SECRET_KEY: null,
    STRIPE_WEBHOOK_SECRET: null,
    FRONTEND_URL: null,
    STRIPE_PRICE_CREATOR_SUB: null,
    STRIPE_PRICE_PRO_SUB: null,
    ELEVENLABS_API_KEY: null,
  });

  try {
    assert.doesNotThrow(() => envCheck());
  } finally {
    restoreEnv();
  }
});

test('envCheck strict mode requires both live Stripe monthly price envs', () => {
  const restoreEnv = withEnv(
    baseStrictEnv({
      STRIPE_PRICE_PRO_SUB: null,
    })
  );

  try {
    const result = expectExit(() => envCheck());
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /STRIPE_PRICE_PRO_SUB/);
  } finally {
    restoreEnv();
  }
});

test('envCheck strict mode requires ELEVENLABS_API_KEY when TTS_PROVIDER is elevenlabs', () => {
  const restoreEnv = withEnv(
    baseStrictEnv({
      TTS_PROVIDER: 'elevenlabs',
      ELEVENLABS_API_KEY: null,
      ELEVEN_VOICE_ID: null,
    })
  );

  try {
    const result = expectExit(() => envCheck());
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /ELEVENLABS_API_KEY/);
    assert.doesNotMatch(result.output, /ELEVEN_VOICE_ID/);
  } finally {
    restoreEnv();
  }
});

test('envCheck strict mode does not require ELEVEN_VOICE_ID when ElevenLabs defaults are available', () => {
  const restoreEnv = withEnv(
    baseStrictEnv({
      TTS_PROVIDER: 'elevenlabs',
      ELEVENLABS_API_KEY: 'eleven-test-key',
      ELEVEN_VOICE_ID: null,
    })
  );

  try {
    assert.doesNotThrow(() => envCheck());
  } finally {
    restoreEnv();
  }
});

test('error middleware sanitizes uncaught 500 responses and preserves requestId', () => {
  const req = {
    id: 'req-500',
    method: 'GET',
    originalUrl: '/api/test',
  };
  const res = mockRes();
  const error = new Error('provider detail should stay in logs only');
  error.code = 'OPENAI_BAD_RESPONSE';

  errorHandler(error, req, res, () => {});

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, {
    success: false,
    error: 'INTERNAL_ERROR',
    detail: 'Unexpected server error',
    requestId: 'req-500',
  });
});

test('error middleware preserves non-500 detail for mapped client errors', () => {
  const req = {
    id: 'req-403',
    method: 'GET',
    originalUrl: '/api/test',
  };
  const res = mockRes();
  const error = new Error('Forbidden for this founder route');
  error.status = 403;
  error.code = 'FORBIDDEN';

  errorHandler(error, req, res, () => {});

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, {
    success: false,
    error: 'FORBIDDEN',
    detail: 'Forbidden for this founder route',
    requestId: 'req-403',
  });
});
