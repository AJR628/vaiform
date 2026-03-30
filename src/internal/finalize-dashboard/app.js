import { auth, provider } from '/admin/finalize/vendor/firebaseClient.js';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const POLL_MS = 10_000;

const els = {
  authButton: document.getElementById('auth-button'),
  authChip: document.getElementById('auth-chip'),
  contextNote: document.getElementById('context-note'),
  dashboardContent: document.getElementById('dashboard-content'),
  eventTableBody: document.getElementById('event-table-body'),
  flowDrainDetail: document.getElementById('flow-drain-detail'),
  flowDrainGrid: document.getElementById('flow-drain-grid'),
  flowDrainHeadline: document.getElementById('flow-drain-headline'),
  flowProviderDetail: document.getElementById('flow-provider-detail'),
  flowProviderGrid: document.getElementById('flow-provider-grid'),
  flowProviderHeadline: document.getElementById('flow-provider-headline'),
  flowProviderList: document.getElementById('flow-provider-list'),
  flowProviderNote: document.getElementById('flow-provider-note'),
  flowQueueGrid: document.getElementById('flow-queue-grid'),
  lastUpdated: document.getElementById('last-updated'),
  linkGrid: document.getElementById('link-grid'),
  localMetrics: document.getElementById('local-metrics'),
  localNote: document.getElementById('local-note'),
  noticePanel: document.getElementById('notice-panel'),
  pressureConfig: document.getElementById('pressure-config'),
  providerList: document.getElementById('provider-list'),
  refreshButton: document.getElementById('refresh-button'),
  sharedMetrics: document.getElementById('shared-metrics'),
  sharedFlowNote: document.getElementById('shared-flow-note'),
  statusBanner: document.getElementById('status-banner'),
  statusText: document.getElementById('status-text'),
  statusTitle: document.getElementById('status-title'),
  summaryHeadline: document.getElementById('summary-headline'),
  summaryNext: document.getElementById('summary-next'),
  summaryWhat: document.getElementById('summary-what'),
  summaryWhy: document.getElementById('summary-why'),
  thresholdGrid: document.getElementById('threshold-grid'),
  thresholdMeta: document.getElementById('threshold-meta'),
  watchList: document.getElementById('watch-list'),
};

const state = {
  user: null,
  pollTimer: null,
};

function describeAuthError(error) {
  const code = error?.code ? String(error.code) : null;
  const message = error?.message || 'Google sign-in could not complete on this origin.';
  return {
    code,
    message,
    detail: code ? `${code}: ${message}` : message,
  };
}

function formatTimestamp(value) {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function setNotice(type, html) {
  if (!html) {
    els.noticePanel.hidden = true;
    els.noticePanel.className = 'notice-panel';
    els.noticePanel.innerHTML = '';
    return;
  }
  els.noticePanel.hidden = false;
  els.noticePanel.className = `notice-panel is-${type}`;
  els.noticePanel.innerHTML = html;
}

function setBanner(verdict, title, text) {
  els.statusBanner.className = `status-banner is-${verdict}`;
  els.statusTitle.textContent = title;
  els.statusText.textContent = text;
}

function clearPoll() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function ensurePoll() {
  clearPoll();
  state.pollTimer = setInterval(() => {
    void loadDashboard({ silent: true });
  }, POLL_MS);
}

function metricCard(metric) {
  const detail = metric.detail || metric.unit || '';
  return `
    <article class="metric-card status-${metric.status || 'healthy'}">
      <div class="metric-label">${metric.label}</div>
      <div class="metric-value">${metric.unit ? `${metric.value}${metric.unit}` : metric.value}</div>
      <div class="metric-detail">${detail || '&nbsp;'}</div>
    </article>
  `;
}

function renderSharedMetrics(sharedHealth) {
  const metrics = Object.values(sharedHealth.metrics || {});
  els.sharedMetrics.innerHTML = metrics.map(metricCard).join('');
}

function renderCardGrid(element, cards = []) {
  element.innerHTML = cards.map(metricCard).join('');
}

function renderPressureConfig(summary = {}) {
  const entries = [
    ['Render limit', summary.renderLimit],
    ['Backlog limit', summary.backlogLimit],
    ['Retry-after', `${summary.overloadRetryAfterSec ?? 'n/a'}s`],
    ['OpenAI slots', summary.openAiSharedLimit],
    ['Story search slots', summary.storySearchSharedLimit],
    ['TTS slots', summary.ttsSharedLimit],
  ];
  els.pressureConfig.innerHTML = entries
    .map(
      ([label, value]) => `
        <article class="config-card">
          <div class="config-label">${label}</div>
          <div class="config-value">${value ?? 'n/a'}</div>
        </article>
      `
    )
    .join('');
}

function renderProviderList(entries = []) {
  els.providerList.innerHTML = entries
    .map(
      (entry) => `
        <article class="provider-card ${entry.cooldownActive ? 'cooldown' : ''}">
          <strong>${entry.label}</strong>
          <div class="provider-state">${entry.cooldownActive ? 'Cooldown active' : 'Ready'}</div>
          <div class="provider-detail">Slots ${entry.activeLeases}/${entry.slotLimit || 0}</div>
          <div class="provider-detail">${
            entry.cooldownActive
              ? `Cooldown until ${formatTimestamp(entry.cooldownUntil)}`
              : entry.failureCount > 0
                ? `Recent failures: ${entry.failureCount}`
                : 'No active cooldown'
          }</div>
        </article>
      `
    )
    .join('');
}

function renderThresholdSummary(thresholdSummary) {
  els.thresholdMeta.innerHTML = `
    <article class="threshold-card">
      <div class="threshold-label">Summary generated</div>
      <div class="threshold-value">${formatTimestamp(thresholdSummary.generatedAt)}</div>
    </article>
    <article class="threshold-card">
      <div class="threshold-label">Scenario count</div>
      <div class="threshold-value">${thresholdSummary.scenarioCount}</div>
    </article>
    <article class="threshold-card">
      <div class="threshold-label">Run count</div>
      <div class="threshold-value">${thresholdSummary.runCount}</div>
    </article>
  `;

  els.thresholdGrid.innerHTML = (thresholdSummary.quickRanges || [])
    .map(
      (range) => `
        <article class="threshold-card">
          <div class="threshold-label">${range.label}</div>
          <div class="threshold-value">G<=${range.greenMax ?? 'n/a'} / Y<=${range.yellowMax ?? 'n/a'}</div>
          <div class="threshold-detail">Shared-health verdict logic reads these JSON bands directly.</div>
        </article>
      `
    )
    .join('');

  els.watchList.innerHTML = (thresholdSummary.watchItems || [])
    .map((item) => `<article class="watch-item">${item}</article>`)
    .join('');
}

function renderLinks(links = []) {
  els.linkGrid.innerHTML = links
    .map(
      (link) => `
        <a class="link-card" href="${link.url}" target="_blank" rel="noreferrer">
          <strong>${link.title}</strong>
          <p>${link.description}</p>
        </a>
      `
    )
    .join('');
}

function renderSharedFlowSnapshot(sharedFlowSnapshot) {
  els.sharedFlowNote.textContent = sharedFlowSnapshot.note;
  renderCardGrid(els.flowQueueGrid, sharedFlowSnapshot.queueFlow?.cards || []);

  els.flowDrainHeadline.textContent =
    sharedFlowSnapshot.drainCorrelation?.headline || 'Unavailable';
  els.flowDrainDetail.textContent = sharedFlowSnapshot.drainCorrelation?.detail || 'Unavailable';
  renderCardGrid(els.flowDrainGrid, sharedFlowSnapshot.drainCorrelation?.cards || []);

  els.flowProviderHeadline.textContent =
    sharedFlowSnapshot.providerPressure?.headline || 'Unavailable';
  els.flowProviderDetail.textContent = sharedFlowSnapshot.providerPressure?.detail || 'Unavailable';
  els.flowProviderNote.textContent = sharedFlowSnapshot.providerPressure?.note || '';
  renderCardGrid(els.flowProviderGrid, sharedFlowSnapshot.providerPressure?.cards || []);

  els.flowProviderList.innerHTML = (sharedFlowSnapshot.providerPressure?.providers || [])
    .map(
      (provider) => `
        <article class="provider-card ${provider.pressureState === 'warning' ? 'cooldown' : ''}">
          <strong>${provider.label}</strong>
          <div class="provider-state">${
            provider.cooldownActive
              ? 'Cooldown active'
              : provider.pressureState === 'warning'
                ? 'Pressure signal'
                : 'Ready'
          }</div>
          <div class="provider-detail">Slots ${provider.activeLeases}/${provider.slotLimit || 0}</div>
          <div class="provider-detail">Failure count ${provider.failureCount}</div>
          <div class="provider-detail">${
            provider.lastFailureCode
              ? `Last failure ${provider.lastFailureCode}`
              : 'No retained failure code'
          }</div>
          <div class="provider-detail">${provider.pressureSummary}</div>
        </article>
      `
    )
    .join('');
}

function renderLocalObservability(localObservability) {
  els.localNote.textContent = localObservability.note;
  const metrics = [
    {
      label: 'Workers active',
      value: localObservability.metrics.workersActive ?? 'n/a',
      detail: 'API process only',
    },
    {
      label: 'Worker saturation',
      value: localObservability.metrics.workerSaturationRatio ?? 'n/a',
      detail: 'API process only',
    },
    {
      label: 'Jobs running',
      value: localObservability.metrics.jobsRunning ?? 'n/a',
      detail: 'Local metric registry',
    },
    {
      label: 'Billing mismatch count',
      value: localObservability.metrics.billingMismatchCount ?? 'n/a',
      detail: 'Local metric registry',
    },
    {
      label: 'Recent readback lag (ms)',
      value: localObservability.metrics.recentReadbackLagMs ?? 'n/a',
      detail: 'Local histogram max',
    },
  ];

  els.localMetrics.innerHTML = metrics
    .map((metric) =>
      metricCard({
        ...metric,
        status: 'healthy',
      })
    )
    .join('');

  els.eventTableBody.innerHTML = (localObservability.recentEvents || []).length
    ? localObservability.recentEvents
        .map(
          (event) => `
            <tr>
              <td>${formatTimestamp(event.ts)}</td>
              <td>${event.event || 'n/a'}</td>
              <td>${event.attemptId || event.finalizeJobId || 'n/a'}</td>
              <td>${event.stage || 'n/a'}</td>
              <td>${event.errorCode || event.failureReason || 'n/a'}</td>
            </tr>
          `
        )
        .join('')
    : '<tr><td colspan="5" class="event-empty">No recent finalize events in this API process.</td></tr>';
}

function renderDashboard(payload) {
  els.contextNote.textContent = payload.context.note;
  els.lastUpdated.textContent = formatTimestamp(payload.generatedAt);
  setBanner(
    payload.sharedHealth.verdict,
    `${payload.sharedHealth.headline}: ${payload.founderSummary.headline}`,
    payload.sharedHealth.issues[0] || 'Shared finalize health is inside the measured green range.'
  );
  setNotice(null, '');

  els.summaryHeadline.textContent = payload.founderSummary.headline;
  els.summaryWhat.textContent = payload.founderSummary.what;
  els.summaryWhy.textContent = payload.founderSummary.why;
  els.summaryNext.textContent = payload.founderSummary.next;

  renderSharedMetrics(payload.sharedHealth);
  renderPressureConfig(payload.sharedHealth.pressureConfigSummary);
  renderProviderList(payload.sharedHealth.providerEntries);
  renderSharedFlowSnapshot(payload.sharedFlowSnapshot);
  renderThresholdSummary(payload.thresholdSummary);
  renderLinks(payload.links);
  renderLocalObservability(payload.localObservability);

  els.dashboardContent.hidden = false;
}

async function fetchDashboardData() {
  if (!state.user) {
    return { status: 401 };
  }

  const token = await state.user.getIdToken();
  const response = await fetch('/api/admin/finalize/data', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : null;
  return {
    status: response.status,
    body,
  };
}

async function loadDashboard({ silent = false } = {}) {
  if (!silent) {
    setBanner(
      'loading',
      'Loading shared finalize health...',
      'Fetching live shared truth and Phase 6 summary.'
    );
  }

  const result = await fetchDashboardData().catch((error) => ({
    status: 0,
    error,
  }));

  if (result.status === 401) {
    clearPoll();
    els.dashboardContent.hidden = true;
    setNotice(
      'auth',
      '<strong>Sign in required.</strong> Use the sign-in button to load live finalize data for this internal page.'
    );
    setBanner(
      'loading',
      'Authentication required',
      'The page shell is available, but live dashboard data requires a signed-in founder account.'
    );
    return;
  }

  if (result.status === 403) {
    clearPoll();
    els.dashboardContent.hidden = true;
    setNotice(
      'error',
      `<strong>Not authorized.</strong> ${
        state.user?.email ? `${state.user.email} is signed in,` : 'This account'
      } but is not allowlisted for the finalize dashboard.`
    );
    setBanner(
      'warning',
      'Founder access required',
      'Live data is protected by the founder allowlist on the backend data route.'
    );
    return;
  }

  if (result.status === 404) {
    clearPoll();
    els.dashboardContent.hidden = true;
    setNotice(
      'error',
      '<strong>Dashboard unavailable.</strong> The backend reports that finalize dashboard access is disabled.'
    );
    setBanner(
      'warning',
      'Dashboard disabled',
      'Set FINALIZE_DASHBOARD_ENABLED=1 on the backend to expose the live data route.'
    );
    return;
  }

  if (result.status !== 200 || !result.body?.success) {
    const detail =
      result.body?.detail ||
      result.error?.message ||
      'The dashboard could not load live finalize data from the backend.';
    setNotice('error', `<strong>Live data unavailable.</strong> ${detail}`);
    setBanner('warning', 'Live data unavailable', detail);
    return;
  }

  renderDashboard(result.body.data);
  ensurePoll();
}

async function handleAuthButton() {
  if (state.user) {
    console.info('[finalize-dashboard] signing out current user', {
      email: state.user.email || null,
    });
    await signOut(auth);
    return;
  }
  console.info('[finalize-dashboard] starting Google popup sign-in', {
    origin: window.location.origin,
  });
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  console.info('[finalize-dashboard] popup sign-in resolved', {
    email: result.user?.email || null,
    uid: result.user?.uid || null,
  });
}

function updateAuthState(user) {
  state.user = user;
  console.info('[finalize-dashboard] onAuthStateChanged', {
    signedIn: Boolean(user),
    email: user?.email || null,
    uid: user?.uid || null,
  });
  els.authChip.textContent = user?.email || 'Not signed in';
  els.authButton.textContent = user ? 'Sign Out' : 'Sign In';
  void loadDashboard();
}

els.refreshButton.addEventListener('click', () => {
  void loadDashboard();
});

els.authButton.addEventListener('click', async () => {
  try {
    await handleAuthButton();
  } catch (error) {
    const authError = describeAuthError(error);
    console.error('[finalize-dashboard] authentication failed', {
      code: authError.code,
      message: authError.message,
      error,
    });
    setNotice('error', `<strong>Authentication failed.</strong> ${authError.detail}`);
  }
});

onAuthStateChanged(auth, (user) => {
  updateAuthState(user);
});
