// src/routes/users.routes.js
import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import admin from "../config/firebase.js";

const r = Router();

/**
 * POST /api/users/ensure - Ensure user document exists (server-side creation)
 * Called after Firebase Auth sign-in to create/merge user doc with defaults
 * 
 * Security: Does NOT trust request body. Derives everything from req.user (auth token)
 */
r.post("/ensure", requireAuth, async (req, res) => {
  try {
    // Do not trust request body - derive everything from auth
    const uid = req.user.uid;
    const email = req.user.email ?? null;

    if (!uid) {
      return res.status(400).json({
        success: false,
        error: "INVALID_REQUEST",
        detail: "User ID not found in auth token"
      });
    }

    const db = admin.firestore();
    const usersRef = db.collection("users");
    
    // Create/merge user doc with defaults (merge: true is idempotent)
    await usersRef.doc(uid).set({
      uid,
      email,
      isMember: false,
      subscriptionStatus: null,
      credits: 0,
      freeShortsUsed: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`[users/ensure] User doc ensured: ${uid} (${email})`);

    return res.json({
      success: true,
      data: {
        uid,
        email,
        isMember: false,
        subscriptionStatus: null,
        credits: 0,
        freeShortsUsed: 0,
      }
    });
  } catch (e) {
    console.error("[users/ensure] error:", e);
    return res.status(500).json({
      success: false,
      error: "ENSURE_FAILED",
      detail: e?.message || "Failed to ensure user document"
    });
  }
});

export default r;

