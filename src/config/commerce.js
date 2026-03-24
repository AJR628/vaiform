const MONTHLY_PLAN_CATALOG = Object.freeze({
  creator: {
    plan: 'creator',
    displayName: 'Creator',
    stripePriceEnvKey: 'STRIPE_PRICE_CREATOR_SUB',
    cycleIncludedSec: 600,
  },
  pro: {
    plan: 'pro',
    displayName: 'Pro',
    stripePriceEnvKey: 'STRIPE_PRICE_PRO_SUB',
    cycleIncludedSec: 1800,
  },
})

export const PLAN_CYCLE_INCLUDED_SEC = Object.freeze({
  free: 0,
  creator: MONTHLY_PLAN_CATALOG.creator.cycleIncludedSec,
  pro: MONTHLY_PLAN_CATALOG.pro.cycleIncludedSec,
})

export function getMonthlyPlanConfig(plan) {
  return MONTHLY_PLAN_CATALOG[plan] ?? null
}

export function getMonthlyPlanPriceId(plan) {
  const config = getMonthlyPlanConfig(plan)
  if (!config) return null
  const priceId = process.env[config.stripePriceEnvKey]
  if (typeof priceId !== 'string') return null
  const trimmed = priceId.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function getPlanForMonthlyPriceId(priceId) {
  if (typeof priceId !== 'string') return null
  const trimmed = priceId.trim()
  if (!trimmed) return null

  for (const plan of Object.keys(MONTHLY_PLAN_CATALOG)) {
    if (getMonthlyPlanPriceId(plan) === trimmed) {
      return plan
    }
  }

  return null
}

export function listConfiguredMonthlyPlans() {
  return Object.keys(MONTHLY_PLAN_CATALOG)
    .map((plan) => {
      const config = getMonthlyPlanConfig(plan)
      const stripePriceId = getMonthlyPlanPriceId(plan)
      return stripePriceId ? { ...config, stripePriceId } : null
    })
    .filter(Boolean)
}

export default {
  PLAN_CYCLE_INCLUDED_SEC,
  getMonthlyPlanConfig,
  getMonthlyPlanPriceId,
  getPlanForMonthlyPriceId,
  listConfiguredMonthlyPlans,
}