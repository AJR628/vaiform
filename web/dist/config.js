// Hardcoded production backend origin (Replit)
export const BACKEND = "https://17e0d1d1-e327-483d-b1ea-c41bea08fb59-00-1ef93t84nlhq6.janeway.replit.dev/";
export const API_ROOT = BACKEND.replace(/\/$/, "") + "/api";
// Optional globals so old scripts never see "API_ROOT is not defined"
if (typeof window !== "undefined") {
  window.BACKEND  = BACKEND;
  window.API_ROOT = API_ROOT;
}
