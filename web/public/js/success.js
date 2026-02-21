// public/js/success.js
import { auth, db, ensureUserDoc } from '/js/firebaseClient.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

let currentUser = null;
const planFromUrl = new URLSearchParams(location.search).get('plan'); // creator/pro/etc.

// Auth state listener
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    await ensureUserDoc(user); // Ensure free plan setup
    setupFirestoreListener(user);
  }
});

// Setup real-time Firestore listener for user data
function setupFirestoreListener(user) {
  const userRef = doc(db, 'users', user.uid);
  const loading = document.getElementById('loading');
  const planInfo = document.getElementById('planInfo');

  loading.classList.add('show');

  // Live update in case webhook lands a second later
  onSnapshot(
    userRef,
    (snap) => {
      if (!snap.exists()) return;

      const userData = snap.data();
      console.log('[success] user plan:', userData.plan, 'credits:', userData.credits);

      // Check if user has been upgraded to a paid plan
      if (userData.isMember && userData.plan !== 'free') {
        showPlanInfo(userData);
        loading.classList.remove('show');
      } else if (planFromUrl && userData.plan === planFromUrl) {
        // Plan matches URL parameter
        showPlanInfo(userData);
        loading.classList.remove('show');
      } else {
        // Still waiting for webhook
        loading.innerHTML = '<p>Activating your plan...</p>';
      }
    },
    (error) => {
      console.error('Firestore listener error:', error);
      loading.innerHTML = '<p>Error checking plan status. Please try refreshing the page.</p>';
    }
  );
}

// Show plan information
function showPlanInfo(userData) {
  const planInfo = document.getElementById('planInfo');
  const planBadge = document.getElementById('planBadge');
  const planName = document.getElementById('planName');
  const planDetails = document.getElementById('planDetails');

  planBadge.textContent = userData.plan;
  planBadge.className = `plan-badge ${userData.plan}`;

  planName.textContent = `${userData.plan.charAt(0).toUpperCase() + userData.plan.slice(1)} Plan Activated`;

  if (userData.membership?.kind === 'onetime') {
    const expiryDate = new Date(userData.membership.expiresAt);
    planDetails.textContent = `One-month pass valid until ${expiryDate.toLocaleDateString()}`;
  } else {
    planDetails.textContent = 'Monthly subscription active';
  }

  planInfo.style.display = 'block';
}

// Get plan from URL parameter
function getPlanFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('plan');
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  const plan = getPlanFromUrl();
  if (plan) {
    console.log('Plan from URL:', plan);
  }
});
