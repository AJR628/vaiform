// src/middleware/requireAuth.js
import admin from "firebase-admin";

export async function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = { uid: decoded.uid, email: decoded.email || null, token: decoded };
    return next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}