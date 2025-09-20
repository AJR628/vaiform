// Unified header component for all pages
// This creates a consistent navigation experience across the site

export function createUnifiedHeader() {
  const headerHTML = `
    <header class="bg-gray-800 dark:bg-gray-800 shadow sticky top-0 z-50">
      <div class="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
        <div class="flex items-center gap-6">
          <h1 class="text-2xl font-bold text-indigo-400">
            <a href="/">Vaiform</a>
          </h1>
          <nav class="space-x-4 text-sm font-medium text-gray-300">
            <a href="/creative.html" class="hover:text-indigo-400 nav-link" data-page="creative">Creative Studio</a>
            <a href="/image-creator.html" class="hover:text-indigo-400 nav-link" data-page="image-creator">Image Creator</a>
            <a href="/my-shorts.html" class="hover:text-indigo-400 nav-link" data-page="shorts">My Shorts</a>
            <a href="/my-images.html" class="hover:text-indigo-400 nav-link" data-page="images">My Images</a>
            <a href="/pricing.html" class="hover:text-indigo-400 nav-link" data-page="pricing">Plans & Pricing</a>
          </nav>
        </div>
        <div class="flex items-center gap-4">
          <!-- Credits display for logged-in users -->
          <div id="credit-display" class="text-sm text-gray-300 logged-in hidden">
            <span class="bg-indigo-900 text-indigo-300 px-2 py-1 rounded-full text-xs font-medium">
              Credits: <span id="credit-count">--</span>
            </span>
            <a href="/buy-credits.html" class="ml-2 text-xs text-indigo-400 hover:underline">buy more</a>
          </div>
          
          <!-- Theme toggle -->
          <button id="theme-toggle" class="text-yellow-400 hover:text-yellow-300 text-xl" title="Toggle theme">🌙</button>
          
          <!-- Auth buttons -->
          <button id="signup-button" class="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 logged-out hidden">Sign Up</button>
          <button id="login-button" class="text-sm border border-gray-600 text-gray-300 px-3 py-1 rounded hover:bg-gray-700 logged-out hidden">Login</button>
          <button id="logout-button" class="text-sm border border-gray-600 text-gray-300 px-3 py-1 rounded hover:bg-gray-700 logged-in hidden">Logout</button>
        </div>
      </div>
    </header>
  `;
  
  return headerHTML;
}

export function initializeHeader() {
  // Set active navigation link based on current page
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll('.nav-link');
  
  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    const isActive = currentPath === href || 
                    (currentPath === '/' && href === '/creative.html') ||
                    (currentPath === '/creative.html' && href === '/creative.html') ||
                    (currentPath === '/image-creator.html' && href === '/image-creator.html');
    
    if (isActive) {
      link.classList.add('text-indigo-400');
      link.classList.remove('text-gray-300');
    }
  });
  
  // Initialize theme toggle
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const html = document.documentElement;
      const isDark = html.classList.contains('dark');
      
      if (isDark) {
        // Switch to light theme
        html.classList.remove('dark');
        localStorage.setItem('theme', 'light');
        themeToggle.textContent = '☀️';
        updateHeaderTheme('light');
      } else {
        // Switch to dark theme
        html.classList.add('dark');
        localStorage.setItem('theme', 'dark');
        themeToggle.textContent = '🌙';
        updateHeaderTheme('dark');
      }
    });
    
    // Set initial theme - default to dark
    const savedTheme = localStorage.getItem('theme');
    const shouldBeDark = savedTheme !== 'light'; // Default to dark unless explicitly set to light
    
    if (shouldBeDark) {
      document.documentElement.classList.add('dark');
      themeToggle.textContent = '🌙';
      updateHeaderTheme('dark');
    } else {
      document.documentElement.classList.remove('dark');
      themeToggle.textContent = '☀️';
      updateHeaderTheme('light');
    }
  }
}

// Function to update header theme classes
function updateHeaderTheme(theme) {
  const header = document.querySelector('header');
  if (!header) return;
  
  if (theme === 'dark') {
    // Dark theme header
    header.className = 'bg-gray-800 shadow sticky top-0 z-50';
    
    // Update body background
    document.body.className = document.body.className.replace(/bg-white|bg-gray-50/, 'bg-gray-900');
    document.body.className = document.body.className.replace(/text-gray-800|text-gray-900/, 'text-gray-100');
    
    // Update navigation links
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
      if (link.classList.contains('text-indigo-400')) return; // Keep active link color
      link.className = link.className.replace(/text-gray-600|text-white/, 'text-gray-300');
    });
    
    // Update credits display
    const creditDisplay = document.getElementById('credit-display');
    if (creditDisplay) {
      creditDisplay.className = creditDisplay.className.replace(/text-gray-600/, 'text-gray-300');
    }
    
    // Update auth buttons
    const authButtons = document.querySelectorAll('#login-button, #logout-button');
    authButtons.forEach(btn => {
      btn.className = btn.className.replace(/border-gray-300|text-gray-600/, 'border-gray-600 text-gray-300');
    });
  } else {
    // Light theme header
    header.className = 'bg-white shadow sticky top-0 z-50';
    
    // Update body background
    document.body.className = document.body.className.replace(/bg-gray-900|bg-gray-950/, 'bg-gray-50');
    document.body.className = document.body.className.replace(/text-gray-100/, 'text-gray-800');
    
    // Update navigation links
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
      if (link.classList.contains('text-indigo-600')) return; // Keep active link color
      link.className = link.className.replace(/text-gray-300/, 'text-gray-600');
    });
    
    // Update credits display
    const creditDisplay = document.getElementById('credit-display');
    if (creditDisplay) {
      creditDisplay.className = creditDisplay.className.replace(/text-gray-300/, 'text-gray-600');
    }
    
    // Update auth buttons
    const authButtons = document.querySelectorAll('#login-button, #logout-button');
    authButtons.forEach(btn => {
      btn.className = btn.className.replace(/border-gray-600|text-gray-300/, 'border-gray-300 text-gray-600');
    });
  }
}
