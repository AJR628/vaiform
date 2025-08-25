import { API_ROOT } from "./config.js";

// Small fetch helper used by the app
export async function apiFetch(path, { method = "GET", headers = {}, body } = {}) {
  const token = await getIdToken();
  const url = `${API_ROOT}${path}`;
  const isPost = (method || "GET").toUpperCase() === "POST";
  const needsIdemp = isPost && /^\/(generate|enhance)(\/|$)/.test(path);
  const idemp = needsIdemp ? `gen-${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0]}` : undefined;

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      ...(needsIdemp ? { "X-Idempotency-Key": idemp } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "omit",
  });

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}

  if (!res.ok) {
    const msg = (json && (json.message || json.error || json.code)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  if (json && typeof json.success === "boolean") {
    if (!json.success) {
      throw new Error(json.message || json.code || "Request failed");
    }
    // Prefer unified shape
    if (json.data && typeof json.data === "object") return json.data;

    // Back-compat: accept legacy top-level keys
    const legacy = {};
    ["images","enhancedPrompt","upscaledUrl","cost","jobId","credits"].forEach(k => {
      if (k in json) legacy[k] = json[k];
    });
    if (Object.keys(legacy).length) return legacy;

    // Treat empty payload as "queued" success
    return {};
  }

  // If no {success} wrapper, return parsed json (legacy)
  return json;
}
