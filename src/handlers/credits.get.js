import admin from "firebase-admin";

// GET /credits handler:
// - Verifies Firebase ID token from Authorization: Bearer <token>
// - Reads Firestore doc users/{uid}.credits (0 if missing)
// - Responds with { success, uid, email, credits }
export async function getCreditsHandler(req, res) {
  try {
    const authz = req.headers["authorization"] || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ success: false, code: "NO_AUTH", message: "Missing Bearer token" });

    const idToken = m[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;
    const email = decoded.email || null;

    const db = admin.firestore();
    const userRef = db.collection("users").doc(uid);
    const snap = await userRef.get();
    const credits = snap.exists ? (snap.get("credits") ?? 0) : 0;

    return res.json({ success: true, uid, email, credits });
  } catch (err) {
    const code = err?.code || err?.message || "credits-error";
    const http = code === "auth/argument-error" ? 401 : 500;
    return res.status(http).json({ success: false, code, message: "Failed to fetch credits" });
  }
}
