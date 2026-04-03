// server.js
import dotenv from 'dotenv';
dotenv.config();

// Check NASA API key configuration at boot
console.log(`[nasa] API key present: ${!!process.env.NASA_API_KEY}`);

import app from './src/app.js';
import { registerDejaVuFonts } from './src/caption/canvas-fonts.js';

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // Replit-friendly

process.on('unhandledRejection', (reason, p) => {
  console.error('[server] Unhandled Rejection at:', p, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught Exception:', err);
});

// Register DejaVu fonts before starting server
console.log('[server] Registering DejaVu fonts...');
const fontStatus = registerDejaVuFonts();
console.log('[server] Font registration result:', fontStatus);

let server;
function start() {
  const legacyStoryRenderRouteEnabled = process.env.ENABLE_STORY_RENDER_ROUTE === '1';

  server = app.listen(PORT, HOST, () => {
    console.log(`[server] Vaiform backend running on http://${HOST}:${PORT}`);
  });

  // Keep a 15-minute server timeout only when the legacy blocking render route
  // is explicitly re-enabled. Finalize is async and should not require the
  // long blocking timeout by default.
  if (legacyStoryRenderRouteEnabled) {
    server.timeout = 900000; // 15 minutes
  }
  server.keepAliveTimeout = 65000; // 65 seconds
  server.headersTimeout = 66000; // 66 seconds

  console.log(
    `[server] Timeouts configured: timeout=${server.timeout}ms, keepAlive=${server.keepAliveTimeout}ms, headers=${server.headersTimeout}ms, legacyStoryRenderRouteEnabled=${legacyStoryRenderRouteEnabled}`
  );
}
function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  if (server) {
    server.close(() => {
      console.log('[server] Closed out remaining connections.');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

start();
['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => shutdown(sig)));
