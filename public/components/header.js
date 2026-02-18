// Unified header component for all pages
// This creates a consistent navigation experience across the site
// Ensure header text respects light/dark theme

export function createUnifiedHeader() {
  const headerHTML = `
    <header class="bg-white dark:bg-gray-800 shadow sticky top-0 z-50">
      <div class="w-full md:max-w-6xl md:mx-auto py-2">
        <!-- Top bar row: Logo left, Credits + Theme + Logout right -->
        <div class="flex items-center justify-between gap-3 md:gap-4 px-4 sm:px-6 lg:px-8">
          <!-- Logo/Brand -->
          <h1 class="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
            <a href="/">Vaiform</a>
          </h1>
          <!-- Right cluster: Credits + Theme + Auth buttons -->
          <div class="flex items-center gap-2">
            <!-- Credits display for logged-in users -->
            <div id="credit-display" class="text-sm text-gray-700 dark:text-gray-300 logged-in hidden">
              <span class="bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded-full text-xs font-medium">
                Credits: <span id="credit-count">--</span>
              </span>
              <a href="/buy-credits.html" class="ml-2 text-xs text-indigo-600 dark:text-indigo-400 hover:underline">buy more</a>
            </div>
            <!-- Theme toggle -->
            <button id="theme-toggle" class="text-yellow-500 dark:text-yellow-400 hover:text-yellow-600 dark:hover:text-yellow-300 text-base" title="Toggle theme">🌙</button>
            <!-- Auth buttons -->
            <button id="signup-button" class="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 logged-out hidden">Sign Up</button>
            <button id="login-button" class="text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-3 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 logged-out hidden">Login</button>
            <button id="logout-button" class="text-xs border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-2 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 logged-in hidden">Logout</button>
          </div>
        </div>
        <!-- Nav row: All navigation links in a wrapping row -->
        <nav class="mt-2 flex flex-wrap gap-2 text-sm sm:text-base md:justify-start md:gap-4 px-4 sm:px-6 lg:px-8">
          <a href="/creative" class="px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-white/5 hover:text-indigo-600 dark:hover:text-indigo-400 nav-link text-gray-700 dark:text-gray-300 font-medium" data-page="creative">Creative Studio</a>
          <a href="/image-creator.html" class="px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-white/5 hover:text-indigo-600 dark:hover:text-indigo-400 nav-link text-gray-700 dark:text-gray-300 font-medium" data-page="image-creator">Image Creator</a>
          <a href="/my-shorts.html" class="px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-white/5 hover:text-indigo-600 dark:hover:text-indigo-400 nav-link text-gray-700 dark:text-gray-300 font-medium" data-page="shorts">My Shorts</a>
          <a href="/my-images.html" class="px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-white/5 hover:text-indigo-600 dark:hover:text-indigo-400 nav-link text-gray-700 dark:text-gray-300 font-medium" data-page="images">My Images</a>
          <a href="/pricing.html" class="px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-white/5 hover:text-indigo-600 dark:hover:text-indigo-400 nav-link text-gray-700 dark:text-gray-300 font-medium" data-page="pricing">Plans & Pricing</a>
        </nav>
      </div>
    </header>
  `;

  return headerHTML;
}

export function initializeHeader() {
  // [AI_IMAGES] Hide Image Creator nav if disabled
  if (window.VAIFORM_FEATURES && !window.VAIFORM_FEATURES.ENABLE_IMAGE_CREATOR) {
    const link = document.querySelector(
      'a[data-page="image-creator"], a[href="/image-creator.html"]'
    );
    if (link) link.style.display = 'none';
  }

  // Set active navigation link based on current page
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll('.nav-link');

  navLinks.forEach((link) => {
    const href = link.getAttribute('href');
    const isActive =
      currentPath === href ||
      (currentPath === '/' && href === '/creative') ||
      (currentPath === '/creative' && href === '/creative') ||
      (currentPath === '/image-creator.html' && href === '/image-creator.html');

    if (isActive) {
      link.classList.add('text-indigo-600', 'dark:text-indigo-400');
      link.classList.remove('text-gray-700', 'dark:text-gray-300');
    }
  });

  // Initialize theme toggle with a small delay to ensure DOM is ready
  setTimeout(() => {
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
      // Remove any existing event listeners
      themeToggle.replaceWith(themeToggle.cloneNode(true));
      const newThemeToggle = document.getElementById('theme-toggle');

      newThemeToggle.addEventListener('click', () => {
        const html = document.documentElement;
        const isDark = html.classList.contains('dark');

        if (isDark) {
          // Switch to light theme
          html.classList.remove('dark');
          localStorage.setItem('theme', 'light');
          newThemeToggle.textContent = '☀️';
        } else {
          // Switch to dark theme
          html.classList.add('dark');
          localStorage.setItem('theme', 'dark');
          newThemeToggle.textContent = '🌙';
        }
      });

      // Set toggle button icon based on current theme state (early script already set the class)
      const isCurrentlyDark = document.documentElement.classList.contains('dark');
      newThemeToggle.textContent = isCurrentlyDark ? '🌙' : '☀️';
    }
  }, 100);
}
