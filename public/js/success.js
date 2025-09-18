// public/js/success.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// Firebase config (should match your existing config)
const firebaseConfig = {
  apiKey: "AIzaSyBvQcZQzQzQzQzQzQzQzQzQzQzQzQzQzQzQ",
  authDomain: "vaiform.firebaseapp.com",
  projectId: "vaiform",
  storageBucket: "vaiform.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdefghijklmnop"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

let currentUser = null;

// Auth state listener
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    await checkUserPlan();
  }
});

// Check user plan status
async function checkUserPlan() {
  const loading = document.getElementById('loading');
  const planInfo = document.getElementById('planInfo');
  
  loading.classList.add('show');
  
  try {
    const token = await currentUser.getIdToken();
    
    // Poll for membership status (webhook might take a moment)
    let attempts = 0;
    const maxAttempts = 10;
    
    while (attempts < maxAttempts) {
      const response = await fetch('/api/user/me', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.data.isMember) {
          showPlanInfo(data.data);
          loading.classList.remove('show');
          return;
        }
      }
      
      // Wait 2 seconds before next attempt
      await new Promise(resolve => setTimeout(resolve, 2000));
      attempts++;
    }
    
    // If we get here, membership wasn't activated yet
    console.warn('Plan activation is taking longer than expected');
    loading.innerHTML = '<p>Plan activation is taking longer than expected. Please refresh the page in a few minutes.</p>';
    
  } catch (error) {
    console.error('Error checking user plan:', error);
    loading.innerHTML = '<p>Error checking plan status. Please try refreshing the page.</p>';
  }
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
