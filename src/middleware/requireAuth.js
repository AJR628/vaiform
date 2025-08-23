import admin from "firebase-admin";

// Safe even if initialized elsewhere
if (!admin.apps.length) {
  try { admin.initializeApp(); } catch {}
}

export default async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!m) {
      return res.status(401).json({
        success: false,
        code: "UNAUTHENTICATED",
        message: "Authentication required",
      });
    }
    const idToken = m[1];
    const decoded = await admin.auth().verifyIdToken(idToken);

    req.user = { uid: decoded.uid, email: decoded.email || null };
    return next();
  } catch (err) {
    console.error("requireAuth verifyIdToken error:", err?.message || err);
    return res.status(401).json({
      success: false,
      code: "UNAUTHENTICATED",
      message: "Invalid or expired token",
    });
  }
}
