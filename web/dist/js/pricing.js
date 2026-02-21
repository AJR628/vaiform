// public/js/pricing.js
import { auth, db, ensureUserDoc } from '/js/firebaseClient.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// Use backend URL directly to bypass Netlify redirects
const API = window.location.hostname.includes('localhost')
  ? 'http://localhost:3000'
  : 'https://17e0d1d1-e327-483d-b1ea-c41bea08fb59-00-1ef93t84nlhq6.janeway.replit.dev';
console.log('[api] BACKEND_BASE =', API);

let currentUser = null;

function checkoutUrlFrom(data) {
  return data?.url ?? data?.data?.url ?? null;
}

function checkoutErrorFrom(data, fallback) {
  return data?.detail ?? data?.error ?? data?.reason ?? fallback;
}

// Auth state listener
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    await ensureUserDoc(user); // Ensure free plan setup

    // Check for pending plan selection after authentication
    const pendingRaw = localStorage.getItem('pendingPlan');
    if (pendingRaw) {
      try {
        const { plan, billing } = JSON.parse(pendingRaw);
        localStorage.removeItem('pendingPlan');

        if (plan === 'free') {
          // Free plan: redirect to creative
          window.location.href = '/creative.html';
          return;
        } else if (plan === 'creator' || plan === 'pro') {
          // Creator/Pro: start checkout
          await proceedWithCheckout(plan, billing || 'onetime');
          return;
        }
      } catch (e) {
        console.warn('[pricing] Failed to parse pendingPlan', e);
        localStorage.removeItem('pendingPlan');
      }
    }

    setupFirestoreListener(user);
  } else {
    hideUserInfo();
  }
});

// Setup real-time Firestore listener for user data
function setupFirestoreListener(user) {
  const userRef = doc(db, 'users', user.uid);

  // Real-time listener for user data changes
  onSnapshot(
    userRef,
    (snap) => {
      if (!snap.exists()) return;

      const userData = snap.data();
      showUserInfo(userData);
      console.log('[pricing] user plan:', userData.plan, 'credits:', userData.credits);
    },
    (error) => {
      console.error('Firestore listener error:', error);
    }
  );
}

function showUserInfo(userData) {
  const userInfo = document.getElementById('userInfo');
  const userEmail = document.getElementById('userEmail');
  const planBadge = document.getElementById('planBadge');

  userEmail.textContent = userData.email;
  planBadge.textContent = userData.plan;
  planBadge.className = `plan-badge ${userData.plan}`;

  userInfo.style.display = 'block';
}

function hideUserInfo() {
  const userInfo = document.getElementById('userInfo');
  userInfo.style.display = 'none';
}

// Unified plan selection handler
async function handlePlanSelection(plan, billing) {
  const user = auth.currentUser;

  if (!user) {
    // Store intent in localStorage, then redirect to login
    localStorage.setItem('pendingPlan', JSON.stringify({ plan, billing }));
    window.location.href = '/login.html';
    return;
  }

  // User is logged in
  if (plan === 'free') {
    // Free: just go to creative; /api/users/ensure will already grant 100 credits
    window.location.href = '/creative.html';
    return;
  }

  // Creator / Pro: use existing checkout helper
  await proceedWithCheckout(plan, billing);
}

// Proceed with checkout after authentication
async function proceedWithCheckout(plan, billing) {
  try {
    const user = auth.currentUser;
    const idToken = await user.getIdToken(true);
    const response = await fetch(`${API}/checkout/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        plan,
        billing,
        uid: user.uid,
        email: user.email,
      }),
    });

    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      throw new Error(
        `Checkout failed [${response.status}] ${contentType.includes('html') ? '(HTML page returned — check route/redirect)' : ''}: ${typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body)}`
      );
    }

    const data = typeof body === 'string' ? null : body;
    const checkoutUrl = checkoutUrlFrom(data);
    if (checkoutUrl) {
      window.location.href = checkoutUrl;
    } else {
      alert('Checkout failed: ' + checkoutErrorFrom(data, 'Unknown error'));
    }
  } catch (error) {
    console.error('Checkout error:', error);
    alert('Checkout failed: ' + error.message);
  }
}

// Delegated click handler for all plan buttons
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.plan-signup');
  if (!btn) return;

  e.preventDefault();

  const plan = btn.getAttribute('data-plan');
  const billing = btn.getAttribute('data-billing') || 'onetime';

  handlePlanSelection(plan, billing);
});
