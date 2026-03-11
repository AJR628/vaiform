import admin from '../config/firebase.js';
import { ensureUserDocByUid } from './credit.service.js';

const db = admin.firestore();

export const PLAN_CYCLE_INCLUDED_SEC = Object.freeze({
  free: 0,
  creator: 600,
  pro: 1800,
});

export function normalizePlan(plan) {
  return typeof plan === 'string' && PLAN_CYCLE_INCLUDED_SEC[plan] != null ? plan : 'free';
}

function toIsoOrNull(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

function toInt(value, fallback = 0) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function normalizeMembership(doc = {}, plan = 'free') {
  const stored = doc.membership && typeof doc.membership === 'object' ? doc.membership : {};
  const legacyStatus =
    typeof doc.subscriptionStatus === 'string' && doc.subscriptionStatus.trim().length > 0
      ? doc.subscriptionStatus
      : null;
  const isLegacyActive = legacyStatus === 'active' || doc.isMember === true;
  const status =
    typeof stored.status === 'string' && stored.status.trim().length > 0
      ? stored.status
      : isLegacyActive
        ? 'active'
        : 'inactive';

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
  };
}

export function normalizeUsage(usage = {}, plan = 'free') {
  return {
    version: 1,
    billingUnit: 'sec',
    periodStartAt: usage.periodStartAt ?? null,
    periodEndAt: usage.periodEndAt ?? null,
    cycleIncludedSec: toInt(usage.cycleIncludedSec, PLAN_CYCLE_INCLUDED_SEC[plan] ?? 0),
    cycleUsedSec: toInt(usage.cycleUsedSec, 0),
    cycleReservedSec: toInt(usage.cycleReservedSec, 0),
    updatedAt: usage.updatedAt ?? null,
  };
}

export function getAvailableSec(usage = {}) {
  return Math.max(0, usage.cycleIncludedSec - usage.cycleUsedSec - usage.cycleReservedSec);
}

export function buildUsagePayload(doc = {}) {
  const plan = normalizePlan(doc.plan);
  const membership = normalizeMembership(doc, plan);
  const usage = normalizeUsage(doc.usage, plan);
  const availableSec = getAvailableSec(usage);

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
  };
}

export async function ensureCanonicalUsageState(uid, email) {
  const { ref } = await ensureUserDocByUid(uid, email);
  const snap = await ref.get();
  const current = snap.data() || {};
  const plan = normalizePlan(current.plan);
  const membership = normalizeMembership(current, plan);
  const usage = normalizeUsage(current.usage, plan);

  await ref.set(
    {
      uid,
      email: email ?? current.email ?? null,
      plan,
      membership,
      usage: {
        ...usage,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const finalSnap = await ref.get();
  return {
    ref,
    data: buildUsagePayload(finalSnap.data() || {}),
  };
}

export async function getUsageSummary(uid, email) {
  const { data } = await ensureCanonicalUsageState(uid, email);
  return data;
}

export default {
  PLAN_CYCLE_INCLUDED_SEC,
  normalizePlan,
  normalizeMembership,
  normalizeUsage,
  getAvailableSec,
  buildUsagePayload,
  ensureCanonicalUsageState,
  getUsageSummary,
};
