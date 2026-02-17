// One-shot SW + Cache killer. Load by visiting any page with ?kill-sw=1
(async () => {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();

      await Promise.all(regs.map((r) => r.unregister()));

      console.log(`[kill-sw] Unregistered ${regs.length} service worker(s).`);
    }
  } catch (e) {
    console.warn('[kill-sw] SW unregister failed:', e);
  }

  try {
    if ('caches' in window) {
      const keys = await caches.keys();

      await Promise.all(keys.map((k) => caches.delete(k)));

      console.log(`[kill-sw] Cleared ${keys.length} cache storages.`);
    }
  } catch (e) {
    console.warn('[kill-sw] Cache clear failed:', e);
  }

  // Small delay so console logs flush, then hard reload

  setTimeout(() => location.reload(true), 200);
})();
