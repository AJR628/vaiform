// src/adapters/replicate.adapter.js
const API = 'https://api.replicate.com/v1';
const TOKEN = process.env.REPLICATE_API_TOKEN;

function assertToken() {
  if (!TOKEN) throw new Error('REPLICATE_TOKEN_MISSING');
}

function normalizeRef({ version, model } = {}) {
  // Explicit version wins
  if (version) return { kind: 'version', version: String(version) };

  if (model) {
    const m = String(model);
    // If model includes a ':versionHash', treat as version
    if (m.includes(':')) {
      const parts = m.split(':');
      const vhash = parts[1];
      return { kind: 'version', version: vhash };
    }
    // Plain owner/name slug
    return { kind: 'model', slug: m };
  }

  throw new Error('REPLICATE_MISSING_REF');
}

function splitSlug(slug) {
  const [owner, namePlus] = String(slug).split('/');
  if (!owner || !namePlus) throw new Error(`Bad slug: ${slug}`);
  const [name] = namePlus.split(':'); // ignore any version part
  return { owner, name };
}

async function createPrediction(ref, input) {
  assertToken();
  const headers = {
    Authorization: `Token ${TOKEN}`,
    'Content-Type': 'application/json',
  };

  let url, body;

  if (ref.kind === 'version') {
    // Generic predictions endpoint requires { version, input }
    url = `${API}/predictions`;
    body = JSON.stringify({ version: ref.version, input });
  } else {
    // Model-scoped endpoint for slugs: /models/{owner}/{name}/predictions
    const { owner, name } = splitSlug(ref.slug);
    url = `${API}/models/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/predictions`;
    body = JSON.stringify({ input });
  }

  const resp = await fetch(url, { method: 'POST', headers, body });
  const text = await resp.text();
  if (!resp.ok) {
    const prefix = `REPLICATE_CREATE_${resp.status}`;
    throw new Error(`${prefix}:${text}`);
  }
  return JSON.parse(text);
}

async function pollPrediction(getUrl) {
  assertToken();
  const headers = { Authorization: `Token ${TOKEN}` };

  for (let i = 0; i < 120; i++) {
    const r = await fetch(getUrl, { headers });
    const t = await r.text();
    if (!r.ok) throw new Error(`REPLICATE_POLL_${r.status}:${t}`);
    const data = JSON.parse(t);

    if (process.env.DIAG === '1' && i === 0) {
      console.log(`[replicate] created prediction version: ${data?.version || '(unknown)'}`);
    }

    if (data.status === 'succeeded') return data;
    if (data.status === 'failed' || data.status === 'canceled') {
      throw new Error(`REPLICATE_${String(data.status).toUpperCase()}:${t}`);
    }
    await new Promise((r) => setTimeout(r, Math.min(5000, 500 + i * 120))); // backoff
  }
  throw new Error('REPLICATE_TIMEOUT');
}

function toArtifacts(data) {
  const out = data?.output;
  const arr = Array.isArray(out) ? out : out ? [out] : [];
  // Some models return strings, others return { url } objects
  const urls = arr.map((v) => (typeof v === 'string' ? v : v?.url)).filter(Boolean);
  return urls.map((u) => ({ type: 'image', url: u }));
}

export default {
  // Text → Image
  async runTextToImage({ input, version, model }) {
    const ref = normalizeRef({ version, model });
    const created = await createPrediction(ref, input);
    const final = await pollPrediction(created.urls.get);
    return { artifacts: toArtifacts(final), raw: final };
  },

  // Image → Image (same flow; just different input keys)
  async runImageToImage({ input, version, model }) {
    return this.runTextToImage({ input, version, model });
  },
};
