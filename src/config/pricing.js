// src/config/pricing.js
export const ENHANCE_COST = 1;

export function costForCount(count) {
  const n = Number(count) || 1;
  if (n <= 1) return 20;
  if (n === 2) return 40;
  if (n >= 4) return 70; // cap at 4+
}

// (optional future)
// export const UPSCALE_COST = 0;
// export const GENERATE_ONE_COST = 20;
// export const GENERATE_TWO_COST = 40;
// export const GENERATE_FOUR_COST = 70;
