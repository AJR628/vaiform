// public/js/pricing.js
import { auth, db, ensureUserDoc } from "/js/firebaseClient.js";
import { uiSignIn, uiSignUp, uiGoogle, routeAfterAuth } from "/js/pricingAuthHandlers.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { API_BASE } from "/js/apiBase.js";

// Use backend URL directly to bypass Netlify redirects
const API = window.location.hostname.includes('localhost') 
  ? 'http://localhost:3000' 
  : 'https://17e0d1d1-e327-483d-b1ea-c41bea08fb59-00-1ef93t84nlhq6.janeway.replit.dev';
console.log("[api] BACKEND_BASE =", API);

let currentUser = null;


// Auth state listener
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    await ensureUserDoc(user); // Ensure free plan setup
    setupFirestoreListener(user);
  } else {
    hideUserInfo();
  }
});

// Setup real-time Firestore listener for user data
function setupFirestoreListener(user) {
  const userRef = doc(db, 'users', user.uid);
  
  // Real-time listener for user data changes
  onSnapshot(userRef, (snap) => {
    if (!snap.exists()) return;
    
    const userData = snap.data();
    showUserInfo(userData);
    console.log('[pricing] user plan:', userData.plan, 'credits:', userData.credits);
  }, (error) => {
    console.error('Firestore listener error:', error);
  });
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

// Store selected plan for after authentication
let selectedPlan = null;
let selectedBilling = null;

// Checkout functions
async function startCheckout(plan, billing) {
  const user = auth.currentUser;
  if (!user) {
    // Store the plan selection and show auth modal
    selectedPlan = plan;
    selectedBilling = billing;
    showAuthModal();
    return;
  }
  
  // User is authenticated, proceed with checkout
  await proceedWithCheckout(plan, billing);
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
    
    // If user selected a paid plan before auth, proceed to checkout
    if (selectedPlan && selectedBilling) {
      await proceedWithCheckout(selectedPlan, selectedBilling);
      selectedPlan = null;
      selectedBilling = null;
    } else {
      await routeAfterAuth(user);
    }
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
    
    // If user selected a paid plan before auth, proceed to checkout
    if (selectedPlan && selectedBilling) {
      await proceedWithCheckout(selectedPlan, selectedBilling);
      selectedPlan = null;
      selectedBilling = null;
    } else {
      await routeAfterAuth(user);
    }
  } catch (error) {
    alert(error.message);
  }
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
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({
        plan,
        billing,
        uid: user.uid,
        email: user.email
      })
    });

    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await response.json() : await response.text();

    if (!response.ok) {
      throw new Error(`Checkout failed [${response.status}] ${contentType.includes('html') ? '(HTML page returned — check route/redirect)' : ''}: ${typeof body === 'string' ? body.slice(0,200) : JSON.stringify(body)}`);
    }

    const data = body;
    if (data.url) {
      window.location.href = data.url;
    } else {
      alert('Checkout failed: ' + (data.reason || 'Unknown error'));
    }
  } catch (error) {
    console.error('Checkout error:', error);
    alert('Checkout failed: ' + error.message);
  }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  // Don't auto-open auth modal - let users choose plans first
  // const params = new URLSearchParams(location.search);
  // if (params.get("auth") === "open") {
  //   showAuthModal();
  // }

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
      
      // If user selected a paid plan before auth, proceed to checkout
      if (selectedPlan && selectedBilling) {
        await proceedWithCheckout(selectedPlan, selectedBilling);
        selectedPlan = null;
        selectedBilling = null;
      } else {
        await routeAfterAuth(user);
      }
    } catch (error) {
      alert(error.message);
    }
  });
});
