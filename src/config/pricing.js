// src/config/pricing.js
export const ENHANCE_COST = 1;

export function costForCount(count) {
  const n = Number(count) || 1;
  if (n <= 1) return 20;
  if (n === 2) return 40;
  if (n >= 4) return 70; // cap at 4+
}
