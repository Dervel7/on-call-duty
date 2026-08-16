import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

import { list, logActivity, recordActivity } from '../services/activity.service'

function entryRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 3,
    action: 'availability.created',
    entity_type: 'unavailability',
    entity_id: 12,
    detail: { type: 'vacation' },
    created_at: new Date('2026-08-16T10:00:00Z'),
    actor_id: 2,
    actor_username: 'admin',
    actor_role: 'administrator',
    actor_first_name: 'Ada',
    actor_last_name: 'Admin',
    ...overrides,
  }
}

beforeEach(() => query.mockReset())

describe('activity.service', () => {
  it('recordActivity inserts user, action, entity, detail as parameterized SQL', async () => {
    const client = { query } as unknown as Parameters<typeof recordActivity>[0]
    await recordActivity(client, {
      userId: 2,
      action: 'availability.created',
      entityType: 'unavailability',
      entityId: 12,
      detail: { type: 'vacation' },
    })
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toContain('INSERT INTO activity_log')
    expect(params).toEqual([2, 'availability.created', 'unavailability', 12, '{"type":"vacation"}'])
  })

  it('recordActivity defaults detail to an empty JSON object', async () => {
    const client = { query } as unknown as Parameters<typeof recordActivity>[0]
    await recordActivity(client, {
      userId: 2,
      action: 'auth.login',
      entityType: 'auth',
      entityId: null,
    })
    expect((query.mock.calls[0] as unknown as unknown[])[1]).toEqual([
      2,
      'auth.login',
      'auth',
      null,
      '{}',
    ])
  })

  it('logActivity wraps recordActivity in a transaction', async () => {
    await logActivity({ userId: 1, action: 'auth.login', entityType: 'auth', entityId: null })
    expect(query.mock.calls[0]?.[0]).toContain('INSERT INTO activity_log')
  })

  it('list runs count then page, ordered newest first', async () => {
    query.mockResolvedValueOnce({ rows: [{ n: 51 }] })
    query.mockResolvedValueOnce({ rows: [entryRow()] })
    const page = await list({ page: 2, limit: 50 })
    expect(page.total).toBe(51)
    expect(page.page).toBe(2)
    expect(page.items[0]?.actor?.firstName).toBe('Ada')
    const pageSql = query.mock.calls[1]?.[0] as string
    expect(pageSql).toContain('ORDER BY a.created_at DESC, a.id DESC')
    expect(pageSql).toContain('LEFT JOIN users u')
  })

  it('list emits one WHERE clause per filter', async () => {
    query.mockResolvedValue({ rows: [] })
    await list({ action: 'auth.login', userId: 5, from: '2026-08-01', to: '2026-08-31' })
    const countSql = query.mock.calls[0]?.[0] as string
    expect(countSql).toContain('a.action')
    expect(countSql).toContain('a.user_id')
    expect(countSql).toContain('a.created_at >=')
    expect(countSql).toContain('a.created_at <')
  })

  it('list maps a deleted actor to null', async () => {
    query.mockResolvedValueOnce({ rows: [{ n: 1 }] })
    query.mockResolvedValueOnce({
      rows: [
        entryRow({
          actor_id: null,
          actor_username: null,
          actor_role: null,
          actor_first_name: null,
          actor_last_name: null,
        }),
      ],
    })
    const page = await list({})
    expect(page.items[0]?.actor).toBeNull()
  })
})
