import { auth, ensureUserDoc } from '/js/firebaseClient.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { apiFetch } from '/api.mjs';

const EXPECTED_PLAN = new URLSearchParams(window.location.search).get('plan');
const MAX_ATTEMPTS = 10;
const POLL_DELAY_MS = 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function setMessage(title, detail, tone = 'neutral') {
  const panel = document.getElementById('messagePanel');
  const titleEl = document.getElementById('messageTitle');
  const detailEl = document.getElementById('messageDetail');
  if (!panel || !titleEl || !detailEl) return;

  titleEl.textContent = title;
  detailEl.textContent = detail;
  panel.className =
    tone === 'error'
      ? 'rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700'
      : tone === 'success'
        ? 'rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700'
        : 'rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sky-700';
}

function showConfirmation(snapshot) {
  const details = document.getElementById('confirmationDetails');
  const usage = snapshot?.usage || {};
  const membership = snapshot?.membership || {};
  const plan = snapshot?.plan || 'free';

  document.getElementById('confirmedPlan').textContent = plan;
  document.getElementById('confirmedMembership').textContent = membership.status || 'inactive';
  document.getElementById('confirmedIncluded').textContent = formatDuration(usage.cycleIncludedSec || 0);
  document.getElementById('confirmedAvailable').textContent = formatDuration(usage.availableSec || 0);
  document.getElementById('confirmedCycleEnd').textContent = formatDate(
    usage.periodEndAt || membership.expiresAt || null
  );

  details.classList.remove('hidden');
}

function isConfirmed(snapshot) {
  if (!snapshot) return false;
  const membership = snapshot.membership || {};
  if (EXPECTED_PLAN && snapshot.plan !== EXPECTED_PLAN) return false;
  return membership.kind === 'subscription' && membership.billingCadence === 'monthly';
}

async function fetchUsageSnapshot() {
  const response = await apiFetch('/usage');
  if (!response?.success) {
    throw new Error(response?.detail || response?.error || 'Unable to confirm billing status.');
  }
  return response.data;
}

async function waitForConfirmation() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const snapshot = await fetchUsageSnapshot();
    if (isConfirmed(snapshot)) {
      return snapshot;
    }
    if (attempt < MAX_ATTEMPTS) {
      await sleep(POLL_DELAY_MS);
    }
  }
  throw new Error('Timed out waiting for plan activation. Refresh this page in a moment.');
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    setMessage(
      'Sign in required',
      'Sign in with the same account you used for checkout to confirm your monthly plan.',
      'error'
    );
    return;
  }

  try {
    await ensureUserDoc(user);
    setMessage(
      'Confirming your subscription',
      'Waiting for backend-owned usage state to reflect the completed Stripe checkout.',
      'neutral'
    );

    const snapshot = await waitForConfirmation();
    setMessage(
      'Plan active',
      'Your render-time subscription is now live and confirmed from /api/usage.',
      'success'
    );
    showConfirmation(snapshot);
  } catch (error) {
    console.error('[success] confirmation failed', error);
    setMessage(
      'Confirmation still pending',
      error?.message || 'Unable to confirm the plan right now.',
      'error'
    );
  }
});
