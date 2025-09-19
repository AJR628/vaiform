// public/js/pricing.js
import { auth, db, ensureUserDoc } from "/js/firebaseClient.js";
import { uiSignIn, uiSignUp, uiGoogle, routeAfterAuth } from "/js/pricingAuthHandlers.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

let currentUser = null;


// Auth state listener
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    await ensureUserDoc(user); // Ensure free plan setup
    await setupUser(user);
    updateUI();
  } else {
    hideUserInfo();
  }
});

// Setup user document after auth
async function setupUser(user) {
  try {
    const token = await user.getIdToken();
    const response = await fetch('/api/user/setup', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      console.error('User setup failed:', await response.text());
    }
  } catch (error) {
    console.error('Error setting up user:', error);
  }
}

// Update UI based on user state
async function updateUI() {
  if (!currentUser) {
    hideUserInfo();
    return;
  }
  
  try {
    const token = await currentUser.getIdToken();
    const response = await fetch('/api/user/me', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      showUserInfo(data.data);
    }
  } catch (error) {
    console.error('Error fetching user data:', error);
  }
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

// Checkout functions
async function startCheckout(plan, billing) {
  const user = auth.currentUser;
  if (!user) {
    showAuthModal();
    return;
  }
  
  try {
    const idToken = await user.getIdToken(true);
    const response = await fetch('/api/checkout/start', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        plan,
        billing,
        uid: user.uid,
        email: user.email
      })
    });
    
    const data = await response.json();
    
    if (data.url) {
      window.location.href = data.url;
    } else {
      alert(`Checkout failed: ${data.reason || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Checkout error:', error);
    alert('Checkout failed. Please try again.');
  }
}

// Auth modal functions
function showAuthModal() {
  const modal = document.getElementById('authModal');
  modal.classList.add('show');
}

function hideAuthModal() {
  const modal = document.getElementById('authModal');
  modal.classList.remove('show');
}

async function signIn() {
  const email = document.getElementById('authEmail').value;
  const password = document.getElementById('authPassword').value;
  
  try {
    const user = await uiSignIn(email, password);
    hideAuthModal();
    await routeAfterAuth(user);
  } catch (error) {
    alert(error.message);
  }
}

async function signUp() {
  const email = document.getElementById('authEmail').value;
  const password = document.getElementById('authPassword').value;
  
  try {
    const user = await uiSignUp(email, password);
    hideAuthModal();
    await routeAfterAuth(user);
  } catch (error) {
    alert(error.message);
  }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  // Auto-open auth modal if ?auth=open in URL
  const params = new URLSearchParams(location.search);
  if (params.get("auth") === "open") {
    showAuthModal();
  }

  // Free plan button
  document.getElementById('startFreeBtn').addEventListener('click', () => {
    if (currentUser) {
      // User is already signed in, redirect to studio
      window.location.href = '/studio';
    } else {
      showAuthModal();
    }
  });
  
  // Creator plan buttons
  document.getElementById('startCreatorMonthlyBtn').addEventListener('click', () => {
    startCheckout('creator', 'monthly');
  });
  
  document.getElementById('startCreatorPassBtn').addEventListener('click', () => {
    startCheckout('creator', 'onetime');
  });
  
  // Pro plan buttons
  document.getElementById('startProMonthlyBtn').addEventListener('click', () => {
    startCheckout('pro', 'monthly');
  });
  
  document.getElementById('startProPassBtn').addEventListener('click', () => {
    startCheckout('pro', 'onetime');
  });
  
  // Auth modal close
  document.getElementById('closeAuthModal').addEventListener('click', hideAuthModal);
  
  // Close modal on outside click
  document.getElementById('authModal').addEventListener('click', (e) => {
    if (e.target.id === 'authModal') {
      hideAuthModal();
    }
  });

  // Google sign-in button
  document.getElementById('googleSignInBtn').addEventListener('click', async () => {
    try {
      const user = await uiGoogle();
      hideAuthModal();
      await routeAfterAuth(user);
    } catch (error) {
      alert(error.message);
    }
  });
});
