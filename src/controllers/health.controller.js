import admin from "firebase-admin";
import { db, bucket } from "../config/firebase.js";
import { openai } from "../config/env.js";

export const root = (req, res) =>
  res.json({ ok: true, message: "Vaiform backend is running 🚀" });

export const healthz = async (req, res) => {
  const checks = {
    env: {
      replicateKey: !!process.env.REPLICATE_API_TOKEN,
      stripeKey: !!process.env.STRIPE_SECRET_KEY,
      openaiKey: !!process.env.OPENAI_API_KEY,
      firebaseServiceAccountLoaded: !!admin.apps.length,
    },
    firestore: null,
    storage: null,
    openai: null,
    replicate: process.env.REPLICATE_API_TOKEN ? "configured" : "no_key",
  };

  try {
    await db.collection("healthcheck").doc("ping").get();
    checks.firestore = "ok";
  } catch (e) {
    checks.firestore = `error: ${e.message}`;
  }

  try {
    await bucket.getFiles({ maxResults: 1 });
    checks.storage = "ok";
  } catch (e) {
    checks.storage = `error: ${e.message}`;
  }

  try {
    if (process.env.OPENAI_API_KEY) {
      await openai.models.list();
      checks.openai = "ok";
    } else {
      checks.openai = "no_key";
    }
  } catch (e) {
    checks.openai = `error: ${e.message}`;
  }

  const failures = Object.values(checks).filter(
    (v) => typeof v === "string" && v.startsWith("error")
  ).length;

  res
    .status(failures ? 207 : 200)
    .json({ status: failures ? "degraded" : "ok", now: new Date().toISOString(), checks });
};

export const version = (req, res) =>
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    node: process.version,
    environment: process.env.NODE_ENV || "development",
    replicateKey: !!process.env.REPLICATE_API_TOKEN,
    stripeKey: !!process.env.STRIPE_SECRET_KEY,
    openaiKey: !!process.env.OPENAI_API_KEY,
    firebaseConfigured: !!admin.apps.length,
  });

export const testFirestore = async (req, res) => {
  try {
    const testRef = db.collection("users").doc("test@example.com");
    await testRef.set({ hello: "world" });
    const snap = await testRef.get();
    res.json({ success: true, data: snap.data() });
  } catch (err) {
    console.error("🔥 Firestore test failed:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const register = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Missing email." });

  try {
    const userRef = db.collection("users").doc(email);
    const docSnap = await userRef.get();

    if (docSnap.exists) {
      return res.json({ success: true, message: "User already exists." });
    }

    await userRef.set({
      credits: 50,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, message: "New user created with 50 credits." });
  } catch (err) {
    console.error("❌ Error in /register:", err.message);
    res.status(500).json({ success: false, error: "Registration failed." });
  }
};