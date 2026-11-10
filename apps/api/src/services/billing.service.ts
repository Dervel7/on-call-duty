import type { AuthUser, BillingState, PaymentAlert, UpdateBillingRequest } from '@oncall/shared'
import { type Run, query, withTransaction } from '../db/client.ts'
import { recordActivity } from './activity.service.ts'

type Actor = Pick<AuthUser, 'id' | 'role'>

const KEY = 'billing_paid_through'

/**
 * The lock comparison runs in SQL against the database's CURRENT_DATE — a
 * client-supplied clock is never trusted. A missing row means unlocked.
 */
export async function isLocked(run: Run = query): Promise<boolean> {
  return (await getState(run)).locked
}

export async function getState(run: Run = query): Promise<BillingState> {
  const res = await run<{ value: string; locked: boolean }>(
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
export async function getPaymentAlert(run: Run = query): Promise<PaymentAlert> {
  const res = await run<{ days_left: number | null }>(
    `SELECT (value::date - CURRENT_DATE) AS days_left FROM app_meta WHERE key = $1`,
    [KEY],
  )
  return { daysLeft: res.rows[0]?.days_left ?? null }
}

export async function setPaidThrough(
  input: UpdateBillingRequest,
  actor: Actor,
): Promise<BillingState> {
  await withTransaction(async (client) => {
    const existing = await client.query<{ value: string }>(
      'SELECT value FROM app_meta WHERE key = $1 FOR UPDATE',
      [KEY],
    )
    await client.query(
      `INSERT INTO app_meta (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [KEY, input.paidThrough],
    )
    await recordActivity(client, {
      userId: actor.id,
      action: 'billing.updated',
      entityType: 'billing',
      entityId: null,
      detail: { previous: existing.rows[0]?.value ?? null, paidThrough: input.paidThrough },
    })
  })
  return getState()
}
