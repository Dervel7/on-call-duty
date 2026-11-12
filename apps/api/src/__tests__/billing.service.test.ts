import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
const clientQuery = vi.fn()
vi.mock('../db/client.ts', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof clientQuery }) => Promise<unknown>) =>
    work({ query: clientQuery }),
}))

const recordActivity = vi.fn()
vi.mock('../services/activity.service.ts', () => ({
  recordActivity: (...a: unknown[]) => recordActivity(...a),
}))

import { setPaidThrough } from '../services/billing.service.ts'

const actor = { id: 1, role: 'superadmin' } as const

beforeEach(() => {
  query.mockReset()
  clientQuery.mockReset()
  recordActivity.mockReset()
  query.mockResolvedValue({ rows: [{ value: '2030-01-01', locked: false }] })
})

describe('setPaidThrough', () => {
  it('upserts and audits billing.updated in the same transaction, with the previous deadline', async () => {
    clientQuery.mockResolvedValueOnce({ rows: [{ value: '2020-01-01' }] })
    clientQuery.mockResolvedValue({ rows: [] })

    await setPaidThrough({ paidThrough: '2030-01-01' }, actor)

    expect(clientQuery.mock.calls[0]?.[0]).toContain('FOR UPDATE')
    const upsert = clientQuery.mock.calls.find((c) => String(c[0]).includes('ON CONFLICT'))
    expect(upsert?.[1]).toEqual(['billing_paid_through', '2030-01-01'])
    expect(query.mock.calls.some((c) => String(c[0]).includes('ON CONFLICT'))).toBe(false)
    expect(recordActivity).toHaveBeenCalledWith(
      { query: clientQuery },
      {
        userId: 1,
        action: 'billing.updated',
        entityType: 'billing',
        entityId: null,
        detail: { previous: '2020-01-01', paidThrough: '2030-01-01' },
      },
    )
  })

  it('audits previous: null when no deadline was set', async () => {
    clientQuery.mockResolvedValue({ rows: [] })
    await setPaidThrough({ paidThrough: '2030-01-01' }, actor)
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ detail: { previous: null, paidThrough: '2030-01-01' } }),
    )
  })

  it('a failed audit write fails the update', async () => {
    clientQuery.mockResolvedValue({ rows: [] })
    recordActivity.mockRejectedValue(new Error('audit insert failed'))
    await expect(setPaidThrough({ paidThrough: '2030-01-01' }, actor)).rejects.toThrow(
      'audit insert failed',
    )
    expect(query).not.toHaveBeenCalled()
  })
})
