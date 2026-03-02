const SAME_ORIGIN = typeof window !== 'undefined' ? window.location.origin : '';
export const BACKEND = SAME_ORIGIN;
export const API_ROOT = '/api';

// Optional globals so old scripts never see "API_ROOT is not defined"
if (typeof window !== 'undefined') {
  window.BACKEND = BACKEND;
  window.API_ROOT = API_ROOT;
}
