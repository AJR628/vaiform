export default async function requireAuth(req, res, next) {
  try {
    if (!req.user || !req.user.uid) {
      return res.status(401).json({
        success: false,
        code: "UNAUTHENTICATED",
        message: "Authentication required",
      });
    }
    next();
  } catch (err) {
    console.error("requireAuth error:", err);
    return res.status(401).json({
      success: false,
      code: "UNAUTHENTICATED",
      message: "Invalid or missing auth",
    });
  }
}
