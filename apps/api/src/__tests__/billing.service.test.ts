import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

const logActivity = vi.fn()
const recordActivity = vi.fn()
vi.mock('../services/activity.service', () => ({
  logActivity: (...a: unknown[]) => logActivity(...a),
  recordActivity: (...a: unknown[]) => recordActivity(...a),
}))

import { getPaymentAlert, getState, isLocked, setPaidThrough } from '../services/billing.service'

const KEY = 'billing_paid_through'

// In-memory app_meta stand-in; cleared between tests so no deadline leaks
// from one test into the next (the DB-backed suite does the same DELETE).
const appMeta = new Map<string, string>()

beforeEach(() => {
  appMeta.clear()
  query.mockReset()
  query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('INSERT INTO app_meta')) {
      appMeta.set(String(params[0]), String(params[1]))
      return { rows: [] }
    }
    const value = appMeta.get(String(params[0]))
    if (value === undefined) return { rows: [] }
    // Postgres compares CURRENT_DATE (a plain calendar date) — string order
    // on ISO dates is the same comparison.
    const locked = value < new Date().toISOString().slice(0, 10)
    if (sql.includes('SELECT value,')) return { rows: [{ value, locked }] }
    if (sql.includes('AS days_left')) {
      // Postgres date subtraction yields whole calendar days; mirror in JS.
      const today = new Date().toISOString().slice(0, 10)
      const daysLeft = Math.round((Date.parse(value) - Date.parse(today)) / 86_400_000)
      return { rows: [{ days_left: daysLeft }] }
    }
    if (sql.includes('AS locked')) return { rows: [{ locked }] }
    return { rows: [{ value }] }
  })
  logActivity.mockReset()
  recordActivity.mockReset()
})

describe('billing.service', () => {
  it('missing app_meta row means unlocked with null paidThrough', async () => {
    await expect(isLocked()).resolves.toBe(false)
    await expect(getState()).resolves.toEqual({ paidThrough: null, locked: false })
  })

  it('a paidThrough in the past locks the system', async () => {
    appMeta.set(KEY, '2020-01-01')
    await expect(isLocked()).resolves.toBe(true)
    await expect(getState()).resolves.toEqual({ paidThrough: '2020-01-01', locked: true })
  })

  it('setPaidThrough upserts, audits billing.updated, and returns fresh state', async () => {
    appMeta.set(KEY, '2020-01-01')
    const paidThrough = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    const state = await setPaidThrough({ paidThrough }, { id: 1, role: 'superadmin' })
    expect(state).toEqual({ paidThrough, locked: false })
    const upsert = query.mock.calls.find((c) => String(c[0]).includes('ON CONFLICT'))
    expect(upsert).toBeDefined()
    expect(logActivity).toHaveBeenCalledWith({
      userId: 1,
      action: 'billing.updated',
      entityType: 'billing',
      entityId: null,
      detail: { previous: '2020-01-01', paidThrough },
    })
  })

  it('setPaidThrough on a missing row audits previous: null', async () => {
    const paidThrough = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    await setPaidThrough({ paidThrough }, { id: 1, role: 'superadmin' })
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, detail: { previous: null, paidThrough } }),
    )
  })

  it('getPaymentAlert: no deadline set means null daysLeft', async () => {
    await expect(getPaymentAlert()).resolves.toEqual({ daysLeft: null })
  })

  it('getPaymentAlert: counts whole days until the deadline', async () => {
    const shift = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
    appMeta.set(KEY, shift(3))
    await expect(getPaymentAlert()).resolves.toEqual({ daysLeft: 3 })
    appMeta.set(KEY, shift(0))
    await expect(getPaymentAlert()).resolves.toEqual({ daysLeft: 0 })
  })
})
