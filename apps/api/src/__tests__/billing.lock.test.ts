import { resolve } from 'node:path'
import { config } from 'dotenv'
import { afterAll, describe, expect, it } from 'vitest'
import type { Run } from '../db/client.ts'

const { parsed } = config({ path: resolve(import.meta.dirname, '../../.env') })
if (parsed?.DATABASE_URL) process.env.DATABASE_URL = parsed.DATABASE_URL

const { pool } = await import('../db/client.ts')
const { getPaymentAlert, getState, isLocked } = await import('../services/billing.service.ts')

const KEY = 'billing_paid_through'

/**
 * Each case runs in a transaction that is rolled back, so the shared
 * billing row is never visible to other test files running in parallel.
 */
async function withDeadline<T>(
  offsetDays: number | null,
  check: (run: Run) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  const run: Run = (text, params) => client.query(text, params)
  try {
    await client.query('BEGIN')
    if (offsetDays === null) {
      await client.query('DELETE FROM app_meta WHERE key = $1', [KEY])
    } else {
      await client.query(
        `INSERT INTO app_meta (key, value)
         VALUES ($1, to_char(CURRENT_DATE + $2::int, 'YYYY-MM-DD'))
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [KEY, offsetDays],
      )
    }
    return await check(run)
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
}

describe('billing lock rule (real database)', () => {
  afterAll(() => pool.end())

  it('no deadline row means unlocked with a null countdown', async () => {
    await withDeadline(null, async (run) => {
      await expect(getState(run)).resolves.toEqual({ paidThrough: null, locked: false })
      await expect(isLocked(run)).resolves.toBe(false)
      await expect(getPaymentAlert(run)).resolves.toEqual({ daysLeft: null })
    })
  })

  it.each([
    { offset: -1, locked: true },
    { offset: 0, locked: false },
    { offset: 1, locked: false },
  ])('a deadline $offset day(s) from today: locked=$locked, daysLeft=$offset', async ({ offset, locked }) => {
    await withDeadline(offset, async (run) => {
      await expect(isLocked(run)).resolves.toBe(locked)
      expect((await getState(run)).locked).toBe(locked)
      await expect(getPaymentAlert(run)).resolves.toEqual({ daysLeft: offset })
    })
  })
})
