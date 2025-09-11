import { auth, provider } from './config.js';
import { onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { BACKEND_URL } from '../config.js';

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
  const cover = s.coverImageUrl || s.videoUrl || '';
  const safeQuote = (s.quoteText || '').trim();
  const statusText = { ready: 'Ready', processing: 'Processing', failed: 'Failed' }[status] || 'Unknown';
  return `
    <article class="short-card" data-status="${status}">
      <div class="thumb">
        ${cover ? `<img alt="Short thumbnail" src="${cover}">` : '<div class="w-full h-full bg-gray-700 flex items-center justify-center text-gray-400">No Preview</div>'}
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
  } catch (e) {
    console.error('Failed to load shorts:', e);
    showEmptyState('Failed to load shorts');
  } finally {
    loading = false;
  }
}

document.getElementById('loadMoreBtn')?.addEventListener('click', () => loadShorts(nextCursor));

document.addEventListener('DOMContentLoaded', () => loadShorts());

function setCreditCount(val){
  const el = document.getElementById('credit-count');
  if (el) el.textContent = String(val);
}

async function refreshCredits(){
  try {
    if (!auth.currentUser) { setCreditCount('--'); return; }
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/limits', { headers: { 'Authorization': `Bearer ${token}` }, credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    setCreditCount(j?.credits ?? '--');
  } catch(e){
    console.warn('credits fetch failed', e?.message || e);
    setCreditCount('--');
  }
}
