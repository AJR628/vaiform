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
  for (const k of keys) assert.ok(k in obj.data, `missing data.${k}`);
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
  });

  await test('GET /credits shape', async () => {
    const r = await api('/credits');
    if (!r.ok) throw new Error(`status ${r.status}: ${r.raw}`);
    expectSuccessData(r.json, ['credits']);
    if (!Number.isFinite(r.json.data.credits)) throw new Error('credits not a number');
  });

  await test('POST /enhance success shape', async () => {
    const r = await api('/enhance', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idem() },
      body: { prompt: 'make colors pop', strength: 0.6 },
    });
    if (!r.ok) throw new Error(`status ${r.status}: ${r.raw}`);
    expectSuccessData(r.json, ['enhancedPrompt', 'cost']);
  });

  await test('POST /generate (txt2img) success shape', async () => {
    const r = await api('/generate', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idem() },
      body: { prompt: 'a single sunflower', count: 1, style: 'realistic' },
    });
    if (!r.ok) throw new Error(`status ${r.status}: ${r.raw}`);
    expectSuccessData(r.json, ['images', 'cost', 'jobId']);
    if (!Array.isArray(r.json.data.images) || r.json.data.images.length === 0)
      throw new Error('images empty');
  });

  await test('POST /generate validation error', async () => {
    const r = await api('/generate', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idem() },
      body: { prompt: '', count: 0, style: 'invalid-style' },
    });
    if (r.ok) throw new Error('expected validation error');
    if (r.json?.success !== false) throw new Error('expected success:false');
  });

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
