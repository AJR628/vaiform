import admin from '../config/firebase.js'
import { PLAN_CYCLE_INCLUDED_SEC } from '../config/commerce.js'
import { ensureUserDocByUid } from './user-doc.service.js'

const db = admin.firestore()
const BILLING_PRECISION_MS = 1
const SEC_DECIMALS = 3

export function normalizePlan(plan) {
  return typeof plan === 'string' && PLAN_CYCLE_INCLUDED_SEC[plan] != null ? plan : 'free'
}

function toIsoOrNull(value) {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  return null
}

function toMillisOrNull(value) {
  if (!value) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toInt(value, fallback = 0) {
  return Number.isInteger(value) && value >= 0 ? value : fallback
}

export function secondsToBillingMs(value, fallback = 0) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return fallback
  return Math.round(numeric * 1000)
}

export function billingMsToSeconds(value, fallback = 0) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return fallback
  const roundedMs = Math.round(numeric / BILLING_PRECISION_MS) * BILLING_PRECISION_MS
  return Number((roundedMs / 1000).toFixed(SEC_DECIMALS))
}

function normalizeStoredSeconds(value, fallback = 0) {
  return billingMsToSeconds(secondsToBillingMs(value, secondsToBillingMs(fallback)))
}

export function getUsageMs(usage = {}, plan = 'free') {
  const normalized = normalizeUsage(usage, plan)
  return {
    cycleIncludedMs: secondsToBillingMs(normalized.cycleIncludedSec),
    cycleUsedMs: secondsToBillingMs(normalized.cycleUsedSec),
    cycleReservedMs: secondsToBillingMs(normalized.cycleReservedSec),
  }
}

export function getAvailableMs(usage = {}, plan = 'free') {
  const normalized = getUsageMs(usage, plan)
  return Math.max(
    0,
    normalized.cycleIncludedMs - normalized.cycleUsedMs - normalized.cycleReservedMs
  )
}

export function applyUsageDelta(usage = {}, deltas = {}, plan = 'free') {
  const normalized = normalizeUsage(usage, plan)
  const current = getUsageMs(normalized, plan)
  const usedDeltaMs = Number(deltas.usedDeltaMs) || 0
  const reservedDeltaMs = Number(deltas.reservedDeltaMs) || 0

  return {
    ...normalized,
    cycleIncludedSec: billingMsToSeconds(current.cycleIncludedMs),
    cycleUsedSec: billingMsToSeconds(Math.max(0, current.cycleUsedMs + usedDeltaMs)),
    cycleReservedSec: billingMsToSeconds(Math.max(0, current.cycleReservedMs + reservedDeltaMs)),
  }
}

function scaleDurationMs(value, ratio = 1) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  return Math.max(0, Math.round(numeric * ratio))
}

export function computeSyncChargeMs(durationMs) {
  return scaleDurationMs(durationMs, 0.5)
}

export function computeRenderChargeMs(durationMs) {
  return scaleDurationMs(durationMs, 0.5)
}

export function normalizeMembership(doc = {}, plan = 'free') {
  const stored = doc.membership && typeof doc.membership === 'object' ? doc.membership : {}
  const status =
    typeof stored.status === 'string' && stored.status.trim().length > 0
      ? stored.status
      : plan !== 'free'
        ? 'active'
        : 'inactive'

  return {
    status,
    kind:
      typeof stored.kind === 'string' && stored.kind.trim().length > 0
        ? stored.kind
        : status === 'active' && plan !== 'free'
          ? 'subscription'
          : 'free',
    billingCadence:
      typeof stored.billingCadence === 'string' && stored.billingCadence.trim().length > 0
        ? stored.billingCadence
        : status === 'active' && plan !== 'free'
          ? 'monthly'
          : 'none',
    startedAt: stored.startedAt ?? null,
    expiresAt: stored.expiresAt ?? null,
    canceledAt: stored.canceledAt ?? null,
  }
}

export function normalizeUsage(usage = {}, plan = 'free') {
  return {
    version: 1,
    billingUnit: 'sec',
    periodStartAt: usage.periodStartAt ?? null,
    periodEndAt: usage.periodEndAt ?? null,
    cycleIncludedSec: normalizeStoredSeconds(usage.cycleIncludedSec, PLAN_CYCLE_INCLUDED_SEC[plan] ?? 0),
    cycleUsedSec: normalizeStoredSeconds(usage.cycleUsedSec, 0),
    cycleReservedSec: normalizeStoredSeconds(usage.cycleReservedSec, 0),
    updatedAt: usage.updatedAt ?? null,
  }
}

export function hasExpiredCanceledSubscription(doc = {}, nowMs = Date.now()) {
  const membership = doc.membership && typeof doc.membership === 'object' ? doc.membership : {}
  const status = typeof membership.status === 'string' ? membership.status.trim() : ''
  const expiresAtMs = toMillisOrNull(membership.expiresAt)
  return status === 'canceled' && Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs
}

export function buildCanonicalUsageState(doc = {}, nowMs = Date.now()) {
  let plan = normalizePlan(doc.plan)
  let membership = normalizeMembership(doc, plan)
  let usage = normalizeUsage(doc.usage, plan)

  if (hasExpiredCanceledSubscription(doc, nowMs)) {
    plan = 'free'
    membership = {
      ...membership,
      status: 'inactive',
      kind: 'free',
      billingCadence: 'none',
    }
    usage = {
      ...normalizeUsage(doc.usage, 'free'),
      cycleIncludedSec: 0,
    }
  }

  return { plan, membership, usage }
}

export function getAvailableSec(usage = {}) {
  return billingMsToSeconds(getAvailableMs(usage))
}

export function buildUsagePayload(doc = {}) {
  const { plan, membership, usage } = buildCanonicalUsageState(doc)
  const availableSec = getAvailableSec(usage)

  return {
    plan,
    membership: {
      status: membership.status,
      kind: membership.kind,
      billingCadence: membership.billingCadence,
      startedAt: toIsoOrNull(membership.startedAt),
      expiresAt: toIsoOrNull(membership.expiresAt),
      canceledAt: toIsoOrNull(membership.canceledAt),
    },
    usage: {
      billingUnit: usage.billingUnit,
      periodStartAt: toIsoOrNull(usage.periodStartAt),
      periodEndAt: toIsoOrNull(usage.periodEndAt),
      cycleIncludedSec: usage.cycleIncludedSec,
      cycleUsedSec: usage.cycleUsedSec,
      cycleReservedSec: usage.cycleReservedSec,
      availableSec,
    },
  }
}

export async function ensureCanonicalUsageState(uid, email) {
  const { ref } = await ensureUserDocByUid(uid, email)
  const snap = await ref.get()
  const current = snap.data() || {}
  const { plan, membership, usage } = buildCanonicalUsageState(current)

  const patch = {
    uid,
    email: email ?? current.email ?? null,
    plan,
    membership,
    usage: {
      ...usage,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }

  await ref.set(patch, { merge: true })

  const finalSnap = await ref.get()
  return {
    ref,
    data: buildUsagePayload(finalSnap.data() || {}),
  }
}

export async function getUsageSummary(uid, email) {
  const { data } = await ensureCanonicalUsageState(uid, email)
  return data
}

export default {
  PLAN_CYCLE_INCLUDED_SEC,
  BILLING_PRECISION_MS,
  normalizePlan,
  normalizeMembership,
  normalizeUsage,
  hasExpiredCanceledSubscription,
  buildCanonicalUsageState,
  secondsToBillingMs,
  billingMsToSeconds,
  getUsageMs,
  getAvailableMs,
  getAvailableSec,
  applyUsageDelta,
  computeSyncChargeMs,
  computeRenderChargeMs,
  buildUsagePayload,
  ensureCanonicalUsageState,
  getUsageSummary,
}
