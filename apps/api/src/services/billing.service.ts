import type { AuthUser, BillingState, PaymentAlert, UpdateBillingRequest } from '@oncall/shared'
import { query } from '../db/client'
import { logActivity } from './activity.service'

type Actor = Pick<AuthUser, 'id' | 'role'>

const KEY = 'billing_paid_through'

/**
 * The lock comparison runs in SQL against the database's CURRENT_DATE — a
 * client-supplied clock is never trusted. A missing row means unlocked.
 */
export async function isLocked(): Promise<boolean> {
  const res = await query<{ locked: boolean }>(
    `SELECT (CURRENT_DATE > value::date) AS locked FROM app_meta WHERE key = $1`,
    [KEY],
  )
  return res.rows[0]?.locked === true
}

export async function getState(): Promise<BillingState> {
  const res = await query<{ value: string; locked: boolean }>(
    `SELECT value, (CURRENT_DATE > value::date) AS locked FROM app_meta WHERE key = $1`,
    [KEY],
  )
  const row = res.rows[0]
  if (!row) return { paidThrough: null, locked: false }
  return { paidThrough: row.value, locked: row.locked }
}

/**
 * Days remaining before the deadline, computed in SQL against the database's
 * CURRENT_DATE like the lock check. Null when no deadline is set.
 */
export async function getPaymentAlert(): Promise<PaymentAlert> {
  const res = await query<{ days_left: number | null }>(
    `SELECT (value::date - CURRENT_DATE) AS days_left FROM app_meta WHERE key = $1`,
    [KEY],
  )
  return { daysLeft: res.rows[0]?.days_left ?? null }
}

export async function setPaidThrough(
  input: UpdateBillingRequest,
  actor: Actor,
): Promise<BillingState> {
  const existing = await query<{ value: string }>(`SELECT value FROM app_meta WHERE key = $1`, [
    KEY,
  ])
  const previous = existing.rows[0]?.value ?? null
  await query(
    `INSERT INTO app_meta (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [KEY, input.paidThrough],
  )
  await logActivity({
    userId: actor.id,
    action: 'billing.updated',
    entityType: 'billing',
    entityId: null,
    detail: { previous, paidThrough: input.paidThrough },
  })
  return getState()
}
