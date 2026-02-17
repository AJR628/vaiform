#!/usr/bin/env node
/**
 * Contract tests for POST /api/caption/preview:
 * 1. Client-measured (desktop): V3 raster payload → 200, data.meta.rasterUrl + geometry.
 * 2. Server-measured (mobile): measure:"server", text, placement, style → 200, same shape.
 *
 * Run: BACKEND_URL=http://localhost:3000 TOKEN=<firebase-id-token> node scripts/test-caption-preview-contract.mjs
 */

import assert from 'node:assert';

const BASE = (process.env.BACKEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
const TOKEN = process.env.TOKEN;

async function api(path, opts = {}) {
  const url = `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method: opts.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(TOKEN && { Authorization: `Bearer ${TOKEN}` }),
        ...opts.headers,
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    return { ok: false, status: 0, json: null, text: err?.message || 'fetch failed' };
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }
  return { ok: res.ok, status: res.status, json, text };
}

function assertMeta(meta, label) {
  assert(meta != null && typeof meta === 'object', `${label}: meta is object`);
  assert(
    typeof meta.rasterUrl === 'string' && meta.rasterUrl.length > 0,
    `${label}: meta.rasterUrl`
  );
  assert(Number.isFinite(meta.rasterW), `${label}: meta.rasterW`);
  assert(Number.isFinite(meta.rasterH), `${label}: meta.rasterH`);
  assert(Number.isFinite(meta.yPx_png), `${label}: meta.yPx_png`);
  assert(Number.isFinite(meta.rasterPadding), `${label}: meta.rasterPadding`);
  assert(Array.isArray(meta.lines) && meta.lines.length > 0, `${label}: meta.lines`);
  assert(Number.isFinite(meta.totalTextH), `${label}: meta.totalTextH`);
}

async function main() {
  if (!TOKEN) {
    console.error('Set TOKEN (Firebase ID token) to run contract tests.');
    process.exit(1);
  }

  let healthRes;
  try {
    healthRes = await fetch(`${BASE}/health`, { method: 'GET' });
  } catch (_e) {
    console.error(
      `Server not reachable at ${BASE}. Ensure it is running and BACKEND_URL is correct.`
    );
    process.exit(1);
  }
  if (!healthRes.ok) {
    console.error(`GET /health returned ${healthRes.status}.`);
    process.exit(1);
  }

  const failures = [];
  async function run(name, fn) {
    try {
      await fn();
      console.log(`✅ ${name}`);
    } catch (e) {
      console.error(`❌ ${name}:`, e.message);
      failures.push(name);
    }
  }

  await run('client-measured (desktop) → 200, rasterUrl + meta', async () => {
    const r = await api('/api/caption/preview', {
      body: {
        ssotVersion: 3,
        mode: 'raster',
        text: 'Hello world',
        lines: ['Hello world'],
        rasterW: 500,
        rasterH: 80,
        yPx_png: 960,
        totalTextH: 50,
        yPxFirstLine: 935,
        frameW: 1080,
        frameH: 1920,
        fontPx: 48,
      },
    });
    assert.strictEqual(r.status, 200, `status 200, got ${r.status}: ${r.text}`);
    assert(r.json?.ok === true, 'ok === true');
    assert(r.json?.data?.meta != null, 'data.meta present');
    assertMeta(r.json.data.meta, 'client-measured');
  });

  await run('server-measured (measure: server) → 200, rasterUrl + meta', async () => {
    const r = await api('/api/caption/preview', {
      body: {
        ssotVersion: 3,
        mode: 'raster',
        measure: 'server',
        text: 'Hello world',
        placement: 'center',
        style: { fontPx: 48 },
        frameW: 1080,
        frameH: 1920,
      },
    });
    assert.strictEqual(r.status, 200, `status 200, got ${r.status}: ${r.text}`);
    assert(r.json?.ok === true, 'ok === true');
    assert(r.json?.data?.meta != null, 'data.meta present');
    assertMeta(r.json.data.meta, 'server-measured');
  });

  await run('server-measured (x-client: mobile fallback, no measure) → 200', async () => {
    const r = await api('/api/caption/preview', {
      headers: { 'x-client': 'mobile' },
      body: {
        ssotVersion: 3,
        mode: 'raster',
        text: 'Mobile fallback',
        placement: 'top',
        style: { fontPx: 56 },
        frameW: 1080,
        frameH: 1920,
      },
    });
    assert.strictEqual(r.status, 200, `status 200, got ${r.status}: ${r.text}`);
    assert(r.json?.ok === true, 'ok === true');
    assert(r.json?.data?.meta != null, 'data.meta present');
    assertMeta(r.json.data.meta, 'x-client fallback');
  });

  await run('server-measured missing placement and yPct → 400', async () => {
    const r = await api('/api/caption/preview', {
      body: {
        ssotVersion: 3,
        mode: 'raster',
        measure: 'server',
        text: 'No placement',
        style: {},
        frameW: 1080,
        frameH: 1920,
      },
    });
    assert.strictEqual(r.status, 400, `status 400, got ${r.status}`);
    assert(r.json?.ok === false, 'ok === false');
  });

  if (failures.length) {
    console.error(`\nFailed: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('\nAll contract tests passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
