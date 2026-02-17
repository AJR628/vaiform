// Shared authentication utilities for consistent auth handling across pages
import { updateCreditsDisplay, fetchAndUpdateCredits } from '/js/credits-ui.js?v=20250920b';

export function initializeAuth() {
  // Wait for Firebase to be available
  if (typeof window.auth === 'undefined') {
    console.warn('Firebase auth not yet available, retrying...');
    setTimeout(initializeAuth, 100);
    return;
  }

  const auth = window.auth;
  const loginBtn = document.getElementById('login-button');
  const signupBtn = document.getElementById('signup-button');
  const logoutBtn = document.getElementById('logout-button');
  const creditDisplay = document.getElementById('credit-display');
  const creditCount = document.getElementById('credit-count');

  // Import Firebase auth functions
  import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js').then(
    ({ onAuthStateChanged, signOut }) => {
      // Listen for auth state changes
      onAuthStateChanged(auth, (user) => {
        updateAuthUI(user);
        if (user) {
          fetchAndUpdateCredits();
        }
      });

      // Set up logout button
      if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
          try {
            await signOut(auth);
            window.location.reload();
          } catch (error) {
            console.error('Logout error:', error);
          }
        });
      }

      // Set up login/signup buttons
      if (loginBtn) {
        loginBtn.addEventListener('click', () => {
          window.location.href = '/login.html';
        });
      }

      if (signupBtn) {
        signupBtn.addEventListener('click', () => {
          window.location.href = '/pricing.html';
        });
      }
    }
  );
}

function updateAuthUI(user) {
  const loggedInElements = document.querySelectorAll('.logged-in');
  const loggedOutElements = document.querySelectorAll('.logged-out');

  if (user) {
    // User is logged in
    loggedInElements.forEach((el) => el.classList.remove('hidden'));
    loggedOutElements.forEach((el) => el.classList.add('hidden'));
  } else {
    // User is not logged in
    loggedInElements.forEach((el) => el.classList.add('hidden'));
    loggedOutElements.forEach((el) => el.classList.remove('hidden'));
  }
}

// Removed - now handled by credits-ui.js module

// Function to check if user is authenticated and show login modal if not
export function requireAuth(callback) {
  if (typeof window.auth === 'undefined') {
    console.warn('Firebase auth not yet available');
    return false;
  }

  const user = window.auth.currentUser;
  if (user) {
    if (callback) callback(user);
    return true;
  } else {
    showLoginModal();
    return false;
  }
}

function showLoginModal() {
  // Create login modal if it doesn't exist
  let modal = document.getElementById('authModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'authModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
        <h3 class="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Sign In Required</h3>
        <p class="text-gray-600 dark:text-gray-400 mb-4">Please sign in to use this feature.</p>
        <div class="flex gap-3">
          <button id="modalLoginBtn" class="flex-1 bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700">
            Sign In
          </button>
          <button id="modalCloseBtn" class="flex-1 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 py-2 px-4 rounded hover:bg-gray-400 dark:hover:bg-gray-500">
            Cancel
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Set up modal event listeners
    document.getElementById('modalLoginBtn').addEventListener('click', () => {
      window.location.href = '/login.html';
    });

    document.getElementById('modalCloseBtn').addEventListener('click', () => {
      modal.remove();
    });

    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }
}
