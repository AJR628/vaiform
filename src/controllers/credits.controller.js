import admin from "firebase-admin";
import { ensureUserDoc } from "../services/credit.service.js";

export async function getCredits(req, res) {
  try {
    const { uid, email } = req.user || {};
    const { ref, data } = await ensureUserDoc(uid || email, email);

    return res.json({
      success: true,
      uid: data?.uid || uid,
      email: data?.email || email,
      credits: data?.credits ?? 0,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      code: "CREDITS_ERROR",
      message: err.message,
    });
  }
}