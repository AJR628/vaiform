function formatRenderTimeAmount(totalSec) {
  const numeric = Number(totalSec);
  if (!Number.isFinite(numeric) || numeric <= 0) return '0s';

  const wholeSec = Math.ceil(numeric);
  const minutes = Math.floor(wholeSec / 60);
  const seconds = wholeSec % 60;

  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function formatRenderTimeLeft(totalSec) {
  const numeric = Number(totalSec);
  if (!Number.isFinite(numeric) || numeric < 0) return '--';
  return `${formatRenderTimeAmount(numeric)} left`;
}

export async function updateUsageDisplay(renderTimeLabel) {
  const usageCountElements = document.querySelectorAll('#usage-count, .usage-count');
  const usageBadgeElements = document.querySelectorAll('#usage-badge, .usage-badge');

  usageCountElements.forEach((el) => {
    if (el) el.textContent = renderTimeLabel || '--';
  });

  usageBadgeElements.forEach((el) => {
    if (el) el.textContent = renderTimeLabel || '--';
  });
}

export async function fetchAndUpdateUsage() {
  try {
    if (typeof window.auth === 'undefined') {
      console.warn('Firebase auth not yet available for usage update');
      await updateUsageDisplay('--');
      return null;
    }

    const user = window.auth.currentUser;
    if (!user) {
      await updateUsageDisplay('--');
      return null;
    }

    const token = await user.getIdToken();
    const res = await fetch('/api/usage', {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const payload = await res.json();
    const availableSec = payload?.data?.usage?.availableSec ?? 0;
    await updateUsageDisplay(formatRenderTimeLeft(availableSec));
    return availableSec;
  } catch (error) {
    console.error('Error fetching render time:', error);
    await updateUsageDisplay('--');
    return null;
  }
}

export function initUsageDisplay() {
  const checkFirebaseReady = () => {
    if (window.auth) {
      fetchAndUpdateUsage();
    } else {
      setTimeout(checkFirebaseReady, 100);
    }
  };

  checkFirebaseReady();
}
