import { auth, ensureUserDoc } from '/js/firebaseClient.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { apiFetch } from '/api.mjs';

const PLAN_LABELS = {
  free: 'Free',
  creator: 'Creator',
  pro: 'Pro',
};

let currentUsage = null;

function formatDuration(totalSec) {
  const seconds = Number(totalSec);
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 min';
  if (seconds < 60) return `${seconds} sec`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem > 0 ? `${mins} min ${rem} sec` : `${mins} min`;
}

function formatDate(value) {
  if (!value) return 'Not scheduled';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Not scheduled' : parsed.toLocaleString();
}

function setStatus(message, tone = 'neutral') {
  const el = document.getElementById('pricingStatus');
  if (!el) return;

  if (!message) {
    el.textContent = '';
    el.className = 'hidden';
    return;
  }

  el.textContent = message;
  el.className =
    tone === 'error'
      ? 'rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700'
      : tone === 'success'
        ? 'rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700'
        : 'rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700';
}

function setBusy(plan, busy) {
  document.querySelectorAll('[data-plan-action]').forEach((button) => {
    const ownsPlan = button.dataset.planAction === plan;
    button.disabled = busy;
    if (ownsPlan) {
      button.dataset.defaultLabel = button.dataset.defaultLabel || button.textContent;
      button.textContent = busy ? 'Opening checkout...' : button.dataset.defaultLabel;
    }
  });
}

function showSignedOutState() {
  document.getElementById('accountPanel')?.classList.add('hidden');
  document.getElementById('signedOutNote')?.classList.remove('hidden');
  document.getElementById('manageBillingBtn')?.classList.add('hidden');
}

function showUsageState(snapshot, email) {
  const accountPanel = document.getElementById('accountPanel');
  const signedOutNote = document.getElementById('signedOutNote');
  const manageBillingBtn = document.getElementById('manageBillingBtn');

  if (!accountPanel || !signedOutNote || !manageBillingBtn) return;

  const plan = snapshot?.plan || 'free';
  const membership = snapshot?.membership || {};
  const usage = snapshot?.usage || {};
  const hasManagedBilling =
    membership.kind === 'subscription' &&
    ['active', 'canceled', 'past_due', 'trialing'].includes(membership.status);

  document.getElementById('accountEmail').textContent = email || 'Signed in';
  document.getElementById('accountPlan').textContent = PLAN_LABELS[plan] || plan;
  document.getElementById('accountMembership').textContent = membership.status || 'inactive';
  document.getElementById('accountIncluded').textContent = formatDuration(usage.cycleIncludedSec || 0);
  document.getElementById('accountAvailable').textContent = formatDuration(usage.availableSec || 0);
  document.getElementById('accountPeriodEnd').textContent = formatDate(
    usage.periodEndAt || membership.expiresAt || null
  );

  accountPanel.classList.remove('hidden');
  signedOutNote.classList.add('hidden');
  manageBillingBtn.classList.toggle('hidden', !hasManagedBilling);
}

async function fetchUsageSnapshot() {
  const response = await apiFetch('/usage');
  if (!response?.success) {
    throw new Error(response?.detail || response?.error || 'Unable to load account usage.');
  }
  currentUsage = response.data;
  return currentUsage;
}

async function startCheckout(plan) {
  const user = auth.currentUser;
  if (!user) {
    localStorage.setItem('pendingPlan', JSON.stringify({ plan }));
    window.location.href = '/login.html';
    return;
  }

  if (plan === 'free') {
    window.location.href = '/creative.html';
    return;
  }

  setStatus('');
  setBusy(plan, true);

  try {
    const response = await apiFetch('/checkout/start', {
      method: 'POST',
      body: { plan },
    });

    if (!response?.success) {
      throw new Error(response?.detail || response?.error || 'Unable to start checkout.');
    }

    const url = response?.data?.url;
    if (!url) {
      throw new Error('Checkout URL missing from server response.');
    }

    window.location.href = url;
  } catch (error) {
    console.error('[pricing] checkout failed', error);
    setStatus(error?.message || 'Unable to start checkout.', 'error');
  } finally {
    setBusy(plan, false);
  }
}

async function openBillingPortal() {
  const button = document.getElementById('manageBillingBtn');
  if (!button) return;

  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Opening portal...';
  setStatus('');

  try {
    const response = await apiFetch('/checkout/portal', {
      method: 'POST',
    });

    if (!response?.success) {
      throw new Error(response?.detail || response?.error || 'Unable to open billing portal.');
    }

    const url = response?.data?.url;
    if (!url) {
      throw new Error('Billing portal URL missing from server response.');
    }

    window.location.href = url;
  } catch (error) {
    console.error('[pricing] billing portal failed', error);
    setStatus(error?.message || 'Unable to open billing portal.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function hydrateSignedInState(user) {
  await ensureUserDoc(user);
  const usage = await fetchUsageSnapshot();
  showUsageState(usage, user.email || '');

  const pendingRaw = localStorage.getItem('pendingPlan');
  if (!pendingRaw) return;

  localStorage.removeItem('pendingPlan');

  try {
    const pending = JSON.parse(pendingRaw);
    const plan = typeof pending?.plan === 'string' ? pending.plan : null;
    if (plan === 'creator' || plan === 'pro') {
      await startCheckout(plan);
    } else if (plan === 'free') {
      window.location.href = '/creative.html';
    }
  } catch (error) {
    console.warn('[pricing] invalid pending plan payload', error);
  }
}

function bindEvents() {
  document.querySelectorAll('[data-plan-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const plan = button.dataset.planAction || '';
      startCheckout(plan);
    });
  });

  document.getElementById('manageBillingBtn')?.addEventListener('click', () => {
    openBillingPortal();
  });
}

function showCanceledNoticeIfNeeded() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('canceled') === '1') {
    setStatus('Checkout was canceled. No billing changes were made.', 'info');
  }
}

bindEvents();
showCanceledNoticeIfNeeded();

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUsage = null;
    showSignedOutState();
    return;
  }

  try {
    await hydrateSignedInState(user);
  } catch (error) {
    console.error('[pricing] failed to load account state', error);
    showSignedOutState();
    setStatus(error?.message || 'Unable to load current plan status.', 'error');
  }
});
