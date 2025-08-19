import { Router } from "express";
import admin from "../config/firebase.js";

const router = Router();

/** Primary health endpoint: verifies Storage bucket exists */
router.get("/", async (_req, res) => {
  try {
    const bucket = admin.storage().bucket();
    const [exists] = await bucket.exists();
    return res.json({
      success: true,
      message: "Vaiform backend is running 🚀",
      storageBucket: bucket.name,
      bucketExists: exists,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "HEALTH_CHECK_FAILED",
      detail: err?.message || String(err),
    });
  }
});

/** Minimal liveness (k8s-style) */
router.get("/healthz", (_req, res) => res.status(200).send("ok"));

/** Optional version info (best-effort) */
router.get("/version", (_req, res) => {
  const version =
    process.env.npm_package_version ||
    process.env.VAIFORM_VERSION ||
    "unknown";
  res.json({ version });
});

export default router;