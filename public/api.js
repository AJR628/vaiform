// Classic-safe shim: if anything loads /api.js via a classic <script>, don't crash.
// It dynamically imports the true ESM at /api.mjs and (optionally) exposes globals.
(async () => {

try {

const m = await import('/api.mjs');

if (!window.apiFetch) window.apiFetch = m.apiFetch;

if (!window.setTokenProvider) window.setTokenProvider = m.setTokenProvider;

window.vaiform_diag = Object.assign({}, window.vaiform_diag, m.vaiform_diag || {});

} catch (e) {

console.error('[api.js shim] import(/api.mjs) failed:', e);

}
})();
