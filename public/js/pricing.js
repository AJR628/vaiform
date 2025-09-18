// public/js/pricing.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ✅ Vaiform project config
const firebaseConfig = {
  apiKey: "AIzaSyBg9bqtZoTkC3vfEXk0vzLJAlTibXfjySY",
  authDomain: "vaiform.firebaseapp.com",
  projectId: "vaiform",
  storageBucket: "vaiform",
  messagingSenderId: "798543382244",
  appId: "1:798543382244:web:a826ce7ed8bebbe0b9cef1",
  measurementId: "G-971DTZ5PEN"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;

// Ensure user document exists with free plan setup
async function ensureUserDoc(user) {
  if (!user || !user.uid) return;
  
  try {
    const ref = doc(db, "users", user.uid);
    await setDoc(ref, {
      email: user.email,
      plan: "free",
      isMember: false,
      credits: 0,
      shortDayKey: new Date().toISOString().slice(0, 10),
      shortCountToday: 0,
      membership: { 
        kind: null, 
        expiresAt: null, 
        nextPaymentAt: null 
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    
    console.log(`[pricing] User doc ensured: ${user.uid} (${user.email})`);
  } catch (error) {
    console.error("Failed to ensure user doc:", error);
  }
}

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
  if (!currentUser) {
    showAuthModal();
    return;
  }
  
  try {
    const token = await currentUser.getIdToken();
    const response = await fetch('/api/checkout/start', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        plan,
        billing,
        uid: currentUser.uid,
        email: currentUser.email
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
  
  // Simple email/password auth form
  const authContainer = document.getElementById('firebaseui-auth-container');
  authContainer.innerHTML = `
    <div style="margin-bottom: 1rem;">
      <input type="email" id="authEmail" placeholder="Email" style="width: 100%; padding: 0.75rem; margin-bottom: 0.5rem; border: 1px solid #d1d5db; border-radius: 4px;">
      <input type="password" id="authPassword" placeholder="Password" style="width: 100%; padding: 0.75rem; margin-bottom: 0.5rem; border: 1px solid #d1d5db; border-radius: 4px;">
    </div>
    <button id="signInBtn" class="btn-plan btn-primary" style="margin-right: 0.5rem;">Sign In</button>
    <button id="signUpBtn" class="btn-plan btn-secondary">Sign Up</button>
  `;
  
  // Add event listeners
  document.getElementById('signInBtn').addEventListener('click', signIn);
  document.getElementById('signUpBtn').addEventListener('click', signUp);
}

function hideAuthModal() {
  const modal = document.getElementById('authModal');
  modal.classList.remove('show');
}

async function signIn() {
  const email = document.getElementById('authEmail').value;
  const password = document.getElementById('authPassword').value;
  
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    const user = result.user;
    await ensureUserDoc(user); // Ensure free plan setup immediately after sign-in
    hideAuthModal();
  } catch (error) {
    alert('Sign in failed: ' + error.message);
  }
}

async function signUp() {
  const email = document.getElementById('authEmail').value;
  const password = document.getElementById('authPassword').value;
  
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    const user = result.user;
    await ensureUserDoc(user); // Ensure free plan setup immediately after sign-up
    hideAuthModal();
  } catch (error) {
    alert('Sign up failed: ' + error.message);
  }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
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
});
