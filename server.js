// server.js
import dotenv from 'dotenv';
dotenv.config();

import app from './src/app.js';

// ---- Config ----
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // Replit-friendly

// ---- Safety nets ----
process.on('unhandledRejection', (reason, p) => {
  console.error('🧯 Unhandled Rejection at:', p, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('🧯 Uncaught Exception:', err);
  // Don't exit immediately in Replit; just log.
});

let server;
function start() {
  server = app.listen(PORT, HOST, () => {
    console.log(`🚀 Vaiform backend running on http://${HOST}:${PORT}`);
  });
}

function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully…`);
  if (server) {
    server.close(() => {
      console.log('✅ HTTP server closed.');
      // Don’t call process.exit() on Replit—just stop listening.
    });
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();

export default server;