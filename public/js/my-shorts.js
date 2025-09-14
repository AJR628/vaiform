import { auth, provider, BACKEND_URL, BACKEND } from './config.js';
import { onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

// Auth state management
onAuthStateChanged(auth, (user) => {
  const loggedIn = !!user;
  document.querySelectorAll('.logged-in')?.forEach(el => el.classList.toggle('hidden', !loggedIn));
  document.querySelectorAll('.logged-out')?.forEach(el => el.classList.toggle('hidden', loggedIn));
  if (loggedIn) {
    refreshCredits();
    loadShorts();
  } else {
    showEmptyState('Please log in to view your shorts', 'login');
    setCreditCount('--');
  }
});

document.getElementById('login-btn')?.addEventListener('click', async () => {
  try { await signInWithPopup(auth, provider); } catch (e) { console.error('Login failed:', e); }
});

document.getElementById('logout-btn')?.addEventListener('click', async () => {
  try { await signOut(auth); } catch (e) { console.error('Logout failed:', e); }
});

let nextCursor = null;
let loading = false;
const myShortsIndex = new Map();

async function fetchMine(cursor) {
  const url = new URL('/shorts/mine', BACKEND_URL);
  url.searchParams.set('limit', '24');
  if (cursor) url.searchParams.set('cursor', cursor);
  const headers = { Accept: 'application/json' };
  if (auth.currentUser) headers['Authorization'] = 'Bearer ' + await auth.currentUser.getIdToken();
  const res = await fetch(url.toString(), { headers, credentials: 'omit' });
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    const text = await res.text().catch(()=> '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0,200)}`);
  }
  if (!/application\/json/i.test(ct)) {
    const text = await res.text().catch(()=> '');
    throw new Error(`Expected JSON, got: ${ct} | ${text.slice(0,200)}`);
  }
  return await res.json();
}

function cardTemplate(s) {
  const status = s.status || 'ready';
  const posters = resolveCover(s);
  const cover = posters.src;
  const safeQuote = (s.quoteText || '').trim();
  const statusText = { ready: 'Ready', processing: 'Processing', failed: 'Failed' }[status] || 'Unknown';
  return `
    <article class="short-card" data-status="${status}" data-id="${s.id || ''}">
      <div class="thumb">
        <img class="thumb-img" alt="thumbnail" data-id="${s.id || ''}" data-video='${posters.videoUrl}' data-ts='${posters.ts}' ${cover ? `src="${cover}"` : ''} />
        <span class="status">${statusText}</span>
      </div>
      <div class="meta">
        <div class="quote">${safeQuote || 'No quote text'}</div>
        <div class="row">
          <span>${(s.durationSec ?? 0)}s • ${s.usedTemplate || s.template || 'default'}</span>
          ${status === 'ready' ? `<a class="btn" href="${s.videoUrl}" target="_blank" rel="noopener">Open</a>` : ''}
        </div>
      </div>
    </article>
  `;
}

function showEmptyState(message, type = 'empty') {
  const grid = document.getElementById('myShortsGrid');
  grid.innerHTML = `
    <div class="empty-state">
      <h3>${message}</h3>
      ${type === 'login' ? '<p>Sign in to start creating shorts!</p>' : '<p>Create your first short in the Creative Studio.</p>'}
    </div>
  `;
}

export async function loadShorts(cursor) {
  if (loading) return;
  loading = true;
  const grid = document.getElementById('myShortsGrid');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  try {
    if (!cursor) grid.innerHTML = '<div class="loading">Loading your shorts...</div>';
    const { success, data } = await fetchMine(cursor);
    if (!success) throw new Error(data?.message || 'Failed to load shorts');
    const { items = [], nextCursor: ncur } = data;
    items.forEach(s => { if (s.id) myShortsIndex.set(s.id, s); });
    const html = items.map(cardTemplate).join('');
    if (cursor) grid.insertAdjacentHTML('beforeend', html);
    else grid.innerHTML = html;
    nextCursor = ncur || null;
    loadMoreBtn.hidden = !nextCursor;
    initPosters();
  } catch (e) {
    console.error('Failed to load shorts:', e);
    showEmptyState('Failed to load shorts');
  } finally {
    loading = false;
  }
}

document.getElementById('loadMoreBtn')?.addEventListener('click', () => loadShorts(nextCursor));

// Gate first load on auth being ready to avoid 401
document.addEventListener('DOMContentLoaded', () => {
  const unsub = onAuthStateChanged(auth, async (u) => {
    if (u) {
      await refreshCredits();
      await loadShorts();
      unsub && unsub();
    }
  });
});

function setCreditCount(val){
  const el = document.getElementById('credit-count');
  if (el) el.textContent = String(val);
}

async function refreshCredits(){
  try {
    if (!auth.currentUser) { setCreditCount('--'); return; }
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/credits', { headers: { 'Authorization': `Bearer ${token}` }, credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    setCreditCount(j?.credits ?? '--');
  } catch(e){
    console.warn('credits fetch failed', e?.message || e);
    setCreditCount('--');
  }
}

// ---------- Poster fallbacks ----------
function withCache(url, ts){
  if (!url) return '';
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${encodeURIComponent(ts || Date.now())}`;
}

function swapNameKeepQuery(fileUrl, newName){
  try {
    const u = new URL(fileUrl);
    u.pathname = u.pathname.replace(/[^/]+$/, newName);
    return u.toString();
  } catch { return ''; }
}

const PROXY_BASE = BACKEND.replace(/\/$/, '');
const proxify = (u) => u ? `${PROXY_BASE}/cdn?u=${encodeURIComponent(u)}` : '';

function resolveCover(s){
  const ts = (s.completedAt || s.createdAt || new Date()).toString();
  const fallbacks = ['__meta__'];
  let raw = s.coverImageUrl || (s.background && s.background.url) || '';
  let first = raw ? withCache(proxify(raw), ts) : '';
  // Do NOT guess cover.jpg with a token from short.mp4 (different token -> 403)
  return { src: first, fallbacks, videoUrl: s.videoUrl || '', ts };
}

async function fetchShortDetail(id){
  try {
    if (!id || !auth.currentUser) return null;
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(`/api/shorts/${id}`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.data || null;
  } catch { return null; }
}

window.tryNextPoster = async function(img){
  try {
    let list = [];
    try { list = JSON.parse(img.dataset.fallbacks || '[]'); } catch {}
    if (!list || list.length === 0) return;
    const next = list.shift();
    img.dataset.fallbacks = JSON.stringify(list);
    if (next === '__meta__'){
      const id = img.dataset.id || '';
      const detail = await fetchShortDetail(id);
      const c = detail?.coverImageUrl ? withCache(detail.coverImageUrl, img.dataset.ts || Date.now()) : '';
      if (c) { img.src = c; return; }
      const card = img.closest('.short-card'); if (card) card.classList.add('no-thumb');
    } else {
      img.src = next;
    }
  } catch {}
}

function nudgePosters(){
  setTimeout(() => {
    document.querySelectorAll('img.thumb-img').forEach(img => {
      const hasSrc = !!img.getAttribute('src');
      if (!hasSrc || !img.complete || img.naturalWidth === 0) {
        tryNextPoster(img);
      }
    });
  }, 800);
}

function initPosters(){
  document.querySelectorAll('img.thumb-img').forEach(img => {
    const id = img.dataset.id || '';
    const item = id ? (myShortsIndex.get(id) || {}) : {};
    loadPoster(img, item);
  });
}

function loadPoster(img, item){
  const metaUrl = item.videoUrl ? swapNameKeepQuery(item.videoUrl, 'meta.json') : '';
  let triedMeta = false;
  let triedVideoPoster = false;
  let retried = false;

  function setSrc(src){ if (src) img.src = src; }

  async function tryMeta(){
    if (triedMeta || !metaUrl) return tryVideoPoster();
    triedMeta = true;
    try {
      const proxied = proxify(metaUrl);
      const r = await fetch(proxied || metaUrl, { cache: 'no-store', credentials: 'omit' });
      if (!r.ok) return tryVideoPoster();
      const m = await r.json();
      if (m?.urls?.cover) return setSrc(withCache(proxify(m.urls.cover) || m.urls.cover, Date.now()));
      return tryVideoPoster();
    } catch { return tryVideoPoster(); }
  }

  function tryVideoPoster(){
    if (triedVideoPoster || !item.videoUrl) return;
    triedVideoPoster = true;
    setSrc(item.videoUrl + '#t=0.2');
  }

  img.onerror = () => {
    if (!triedMeta || !triedVideoPoster) return tryMeta();
    if (!retried && item.coverImageUrl){
      retried = true;
      setTimeout(() => setSrc(withCache(item.coverImageUrl, Date.now())), 900);
    }
  };

  if (item.coverImageUrl) setSrc(withCache(proxify(item.coverImageUrl) || item.coverImageUrl, Date.now()));
  else tryMeta();
}
