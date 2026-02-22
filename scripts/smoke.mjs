// scripts/smoke.mjs
// Run with: node scripts/smoke.mjs  (Node 18+)
import assert from 'node:assert';

const BACKEND_URL = process.env.BACKEND_URL?.replace(/\/+$/, '');
const TOKEN = process.env.TOKEN;

if (!BACKEND_URL || !TOKEN) {
  console.error('Set BACKEND_URL and TOKEN env vars first.');
  process.exit(1);
}

async function api(path, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { ok: res.ok, status: res.status, json, raw: text };
}

function expectSuccessData(obj, keys = []) {
  assert.equal(obj?.success, true, 'success !== true');
  assert.equal(typeof obj?.data, 'object', 'missing data object');
  assert.ok('requestId' in obj, 'missing requestId');
  for (const k of keys) assert.ok(k in obj.data, `missing data.${k}`);
}

function expectFailureEnvelope(obj, keys = []) {
  assert.equal(obj?.success, false, 'success !== false');
  assert.equal(typeof obj?.error, 'string', 'missing error');
  assert.equal(typeof obj?.detail, 'string', 'missing detail');
  assert.ok('requestId' in obj, 'missing requestId');
  for (const k of keys) assert.ok(k in obj, `missing ${k}`);
}

function idem() {
  return `cli-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

(async () => {
  const failures = [];
  async function test(name, fn) {
    try {
      await fn();
      console.log(`✅ ${name}`);
    } catch (e) {
      console.error(`❌ ${name}:`, e.message);
      failures.push(name);
    }
  }

  await test('GET /health returns 200', async () => {
    const r = await api('/health');
    if (!r.ok) throw new Error(`status ${r.status}: ${r.raw}`);
    expectSuccessData(r.json, ['service', 'time']);
  });

  await test('GET /api/health returns 200', async () => {
    const r = await api('/api/health');
    if (!r.ok) throw new Error(`status ${r.status}: ${r.raw}`);
    expectSuccessData(r.json, ['service', 'time']);
  });

  await test('GET /api/whoami shape', async () => {
    const r = await api('/api/whoami');
    if (!r.ok) throw new Error(`status ${r.status}: ${r.raw}`);
    expectSuccessData(r.json, ['uid', 'email']);
  });

  await test('GET /api/credits shape', async () => {
    const r = await api('/api/credits');
    if (!r.ok) throw new Error(`status ${r.status}: ${r.raw}`);
    expectSuccessData(r.json, ['credits']);
    if (!Number.isFinite(r.json.data.credits)) throw new Error('credits not a number');
  });

  await test('POST /api/checkout/start validation contract', async () => {
    const r = await api('/api/checkout/start', {
      method: 'POST',
      body: { plan: 'invalid', billing: 'onetime' },
    });
    if (r.status !== 400) throw new Error(`expected 400, got ${r.status}: ${r.raw}`);
    expectFailureEnvelope(r.json);
    if (r.json.error !== 'INVALID_PLAN') {
      throw new Error(`expected INVALID_PLAN, got ${r.json.error}`);
    }
  });

  if (process.env.SMOKE_INCLUDE_GENERATE === '1') {
    await test('POST /api/generate contract', async () => {
      const r = await api('/api/generate', {
        method: 'POST',
        headers: { 'X-Idempotency-Key': idem() },
        body: { prompt: 'a single sunflower', count: 1, style: 'realistic' },
      });
      if (r.status === 404) throw new Error('generate route not mounted');
      if (!r.json || typeof r.json !== 'object') throw new Error(`non-json response: ${r.raw}`);
      if (r.json.success === true) {
        expectSuccessData(r.json, ['images', 'cost', 'jobId']);
        return;
      }
      expectFailureEnvelope(r.json);
    });
  }

  if (failures.length) {
    console.error(`\n${failures.length} test(s) failed.`);
    process.exit(1);
  } else {
    console.log('\n🎉 All backend contract tests passed.');
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
