// src/routes/user.routes.js
import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { ensureFreeUser, getUserData } from "../services/user.service.js";

const r = Router();

/**
 * POST /user/setup - Ensure user document exists after signup
 * Called after Firebase Auth sign-in to create/update user doc
 */
r.post("/setup", requireAuth, async (req, res) => {
  try {
    const { uid, email } = req.user;
    
    const result = await ensureFreeUser(uid, email);
    
    return res.json({
      ok: true,
      data: {
        uid,
        email,
        plan: 'free',
        isMember: false,
      }
    });
  } catch (e) {
    console.error("[user/setup] error", e);
    return res.status(500).json({
      ok: false,
      reason: "SETUP_FAILED",
      detail: e?.message || "User setup failed"
    });
  }
});

/**
 * GET /user/me - Get current user data
 */
r.get("/me", requireAuth, async (req, res) => {
  try {
    const { uid } = req.user;
    
    const userData = await getUserData(uid);
    
    if (!userData) {
      return res.status(404).json({
        ok: false,
        reason: "USER_NOT_FOUND",
        detail: "User document not found"
      });
    }
    
    return res.json({
      ok: true,
      data: {
        uid,
        email: userData.email,
        plan: userData.plan || 'free',
        isMember: userData.isMember || false,
        credits: userData.credits || 0,
        membership: userData.membership || null,
      }
    });
  } catch (e) {
    console.error("[user/me] error", e);
    return res.status(500).json({
      ok: false,
      reason: "FETCH_FAILED",
      detail: e?.message || "Failed to fetch user data"
    });
  }
});

export default r;
