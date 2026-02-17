// src/adapters/index.js
import replicate from './replicate.adapter.js';

export const ADAPTERS = {
  replicate,
};

// No per-model adapters yet — controller will use provider fallback
export const MODELS = {};

export default { ADAPTERS, MODELS };
