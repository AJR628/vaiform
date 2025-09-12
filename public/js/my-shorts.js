import { auth, provider } from './config.js';
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

async function fetchMine(cursor) {
  const url = new URL('/api/shorts/mine', location.origin);
  url.searchParams.set('limit', '24');
  if (cursor) url.searchParams.set('cursor', cursor);
  const headers = {};
  if (auth.currentUser) headers['Authorization'] = 'Bearer ' + await auth.currentUser.getIdToken();
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
        ${cover ? `<img class="thumb-img" alt="Short thumbnail" src="${cover}" data-id="${s.id || ''}" data-video='${posters.videoUrl}' data-ts='${posters.ts}' onerror="tryNextPoster(this)">` : '<div class="w-full h-full bg-gray-700 flex items-center justify-center text-gray-400">No Preview</div>'}
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
    const html = items.map(cardTemplate).join('');
    if (cursor) grid.insertAdjacentHTML('beforeend', html);
    else grid.innerHTML = html;
    nextCursor = ncur || null;
    loadMoreBtn.hidden = !nextCursor;
    nudgePosters();
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

function resolveCover(s){
  const ts = (s.completedAt || s.createdAt || new Date()).toString();
  const fallbacks = ['__meta__'];
  let first = '';
  if (s.coverImageUrl) first = withCache(s.coverImageUrl, ts);
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
