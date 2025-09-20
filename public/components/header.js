// Unified header component for all pages
// This creates a consistent navigation experience across the site

export function createUnifiedHeader() {
  const headerHTML = `
    <header class="bg-white dark:bg-gray-800 shadow sticky top-0 z-50">
      <div class="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
        <div class="flex items-center gap-6">
          <h1 class="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
            <a href="/">Vaiform</a>
          </h1>
          <nav class="space-x-4 text-sm font-medium text-gray-600 dark:text-gray-300">
            <a href="/creative.html" class="hover:text-indigo-600 dark:hover:text-indigo-400 nav-link" data-page="creative">Creative Studio</a>
            <a href="/image-creator.html" class="hover:text-indigo-600 dark:hover:text-indigo-400 nav-link" data-page="image-creator">Image Creator</a>
            <a href="/my-shorts.html" class="hover:text-indigo-600 dark:hover:text-indigo-400 nav-link" data-page="shorts">My Shorts</a>
            <a href="/my-images.html" class="hover:text-indigo-600 dark:hover:text-indigo-400 nav-link" data-page="images">My Images</a>
            <a href="/pricing.html" class="hover:text-indigo-600 dark:hover:text-indigo-400 nav-link" data-page="pricing">Plans & Pricing</a>
          </nav>
        </div>
        <div class="flex items-center gap-4">
          <!-- Credits display for logged-in users -->
          <div id="credit-display" class="text-sm text-gray-600 dark:text-gray-300 logged-in hidden">
            <span class="bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded-full text-xs font-medium">
              Credits: <span id="credit-count">--</span>
            </span>
            <a href="/buy-credits.html" class="ml-2 text-xs text-indigo-600 dark:text-indigo-400 hover:underline">buy more</a>
          </div>
          
          <!-- Theme toggle -->
          <button id="theme-toggle" class="text-yellow-400 hover:text-yellow-300 text-xl" title="Toggle theme">🌙</button>
          
          <!-- Auth buttons -->
          <button id="signup-button" class="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 logged-out hidden">Sign Up</button>
          <button id="login-button" class="text-sm border px-3 py-1 rounded logged-out hidden">Login</button>
          <button id="logout-button" class="text-sm border px-3 py-1 rounded logged-in hidden">Logout</button>
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
      link.classList.add('text-indigo-600', 'dark:text-indigo-400');
      link.classList.remove('text-gray-600', 'dark:text-gray-300');
    }
  });
  
  // Initialize theme toggle
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const html = document.documentElement;
      const isDark = html.classList.contains('dark');
      
      if (isDark) {
        html.classList.remove('dark');
        localStorage.setItem('theme', 'light');
        themeToggle.textContent = '🌙';
      } else {
        html.classList.add('dark');
        localStorage.setItem('theme', 'dark');
        themeToggle.textContent = '☀️';
      }
    });
    
    // Set initial theme
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldBeDark = savedTheme === 'dark' || (!savedTheme && prefersDark);
    
    if (shouldBeDark) {
      document.documentElement.classList.add('dark');
      themeToggle.textContent = '☀️';
    }
  }
}
