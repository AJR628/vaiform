// src/middleware/auth.js
import admin from "../config/firebase.js"; // initialized Firebase Admin instance

export default async function requireAuth(req, res, next) {
  try {
    // Accept token from header OR ?token= for quick tests
    const header =
      req.headers.authorization ||
      req.headers.Authorization ||
      "";
    const queryToken = req.query?.token || "";

    const raw = header || queryToken;
    if (!raw) {
      return res.status(401).json({
        error: "UNAUTHENTICATED",
        message: "Missing Authorization: Bearer <token>",
      });
    }

    // Allow both "Bearer <token>" and raw "<token>"
    const token = raw.startsWith("Bearer ") ? raw.slice(7) : raw;

    const decoded = await admin.auth().verifyIdToken(token);
    if (!decoded?.uid) {
      return res.status(401).json({
        error: "UNAUTHENTICATED",
        message: "Invalid token",
      });
    }

    // Attach minimal identity
    req.user = {
      uid: decoded.uid,
      email: decoded.email || null,
    };

    return next();
  } catch (err) {
    console.error("❌ Auth verify failed:", err?.code || err?.name, err?.message || err);
    return res.status(401).json({
      error: "UNAUTHENTICATED",
      message: "Invalid or expired token",
    });
  }
}
