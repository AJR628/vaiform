// server.js
import dotenv from "dotenv";
dotenv.config();

import app from "./src/app.js";

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0"; // Replit-friendly

process.on("unhandledRejection", (reason, p) => {
  console.error("🧯 Unhandled Rejection at:", p, "reason:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("🧯 Uncaught Exception:", err);
});

let server;
function start() {
  server = app.listen(PORT, HOST, () => {
    console.log(`🚀 Vaiform backend running on http://${HOST}:${PORT}`);
  });
  
  // Set server timeouts to handle long-running image generation requests
  server.timeout = 600000; // 10 minutes
  server.keepAliveTimeout = 65000; // 65 seconds
  server.headersTimeout = 66000; // 66 seconds
  
  console.log(`⏱️  Server timeouts configured: timeout=${server.timeout}ms, keepAlive=${server.keepAliveTimeout}ms, headers=${server.headersTimeout}ms`);
}
function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully…`);
  if (server) {
    server.close(() => {
      console.log("✅ Closed out remaining connections.");
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

start();
["SIGINT", "SIGTERM"].forEach(sig => process.on(sig, () => shutdown(sig)));