// Credits display utility functions
// Centralized credit management for consistent UI updates

export async function updateCreditsDisplay(credits) {
  const creditCountElements = document.querySelectorAll('#credit-count, .credit-count');
  const creditBadgeElements = document.querySelectorAll('#credits-badge, .credits-badge');
  
  // Update all credit count displays
  creditCountElements.forEach(el => {
    if (el) el.textContent = credits || '--';
  });
  
  // Update all credit badge displays
  creditBadgeElements.forEach(el => {
    if (el) el.textContent = credits || '--';
  });
}

export async function fetchAndUpdateCredits() {
  try {
    // Import Firebase functions dynamically
    const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    
    // Check if Firebase is available
    if (typeof window.auth === 'undefined' || typeof window.db === 'undefined') {
      console.warn('Firebase not yet available for credits update');
      return;
    }
    
    const user = window.auth.currentUser;
    if (!user) return;

    const userDoc = await getDoc(doc(window.db, 'users', user.uid));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      const credits = userData.credits || 0;
      await updateCreditsDisplay(credits);
      return credits;
    }
  } catch (error) {
    console.error('Error fetching credits:', error);
    await updateCreditsDisplay('--');
  }
}

// Initialize credits display when page loads
export function initCreditsDisplay() {
  // Wait for Firebase to be ready
  const checkFirebaseReady = () => {
    if (window.auth && window.db) {
      fetchAndUpdateCredits();
    } else {
      setTimeout(checkFirebaseReady, 100);
    }
  };
  
  checkFirebaseReady();
}