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
  console.error('🧯 Unhandled Rejection at:', p, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('🧯 Uncaught Exception:', err);
});

// Register DejaVu fonts before starting server
console.log('[server] Registering DejaVu fonts...');
const fontStatus = registerDejaVuFonts();
console.log('[server] Font registration result:', fontStatus);

let server;
function start() {
  server = app.listen(PORT, HOST, () => {
    console.log(`🚀 Vaiform backend running on http://${HOST}:${PORT}`);
  });

  // Set server timeout to 15 minutes to accommodate blocking render operations.
  // Note: Render operations (finalizeStudio/finalizeStory) currently run synchronously
  // inside HTTP request handlers, blocking the connection until completion. This timeout
  // increase is a P0 mitigation to reduce false client timeouts; it is NOT a scalability fix.
  // Full solution requires background job queue (P2).
  server.timeout = 900000; // 15 minutes
  server.keepAliveTimeout = 65000; // 65 seconds
  server.headersTimeout = 66000; // 66 seconds

  console.log(
    `⏱️  Server timeouts configured: timeout=${server.timeout}ms, keepAlive=${server.keepAliveTimeout}ms, headers=${server.headersTimeout}ms`
  );
}
function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully…`);
  if (server) {
    server.close(() => {
      console.log('✅ Closed out remaining connections.');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

start();
['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => shutdown(sig)));
