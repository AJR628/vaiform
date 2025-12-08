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
    const userRef = db.collection("users").doc(uid);
    
    // Check if user doc already exists
    const userSnap = await userRef.get();
    const docExists = userSnap.exists;
    
    if (!docExists) {
      // New user: create doc with welcome credits
      await userRef.set({
        uid,
        email,
        plan: "free",
        isMember: false,
        subscriptionStatus: null,
        credits: 100,
        freeShortsUsed: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      console.log(`[users/ensure] User doc created with 100 welcome credits: ${uid} (${email})`);
      
      return res.json({
        success: true,
        data: {
          uid,
          email,
          plan: "free",
          isMember: false,
          subscriptionStatus: null,
          credits: 100,
          freeShortsUsed: 0,
        }
      });
    } else {
      // Existing user: only update email and updatedAt, preserve all other fields
      const updateData = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      
      // Only update email if it's different or missing
      const existingData = userSnap.data() || {};
      if (email && existingData.email !== email) {
        updateData.email = email;
      }
      
      await userRef.update(updateData);
      
      console.log(`[users/ensure] User doc updated (preserved credits/membership): ${uid} (${email})`);
      
      // Return existing data (preserving credits, membership, etc.)
      const currentData = (await userRef.get()).data() || {};
      return res.json({
        success: true,
        data: {
          uid,
          email: currentData.email || email,
          isMember: currentData.isMember ?? false,
          subscriptionStatus: currentData.subscriptionStatus ?? null,
          credits: currentData.credits ?? 0,
          freeShortsUsed: currentData.freeShortsUsed ?? 0,
        }
      });
    }
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

