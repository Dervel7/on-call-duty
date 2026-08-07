import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

import { create, list, remove, update } from '../services/holiday.service'

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    name: 'Sample Holiday',
    date: '2026-09-01',
    created_at: new Date('2026-08-01'),
    updated_at: new Date('2026-08-01'),
    ...overrides,
  }
}

beforeEach(() => query.mockReset())

describe('holiday.service', () => {
  it('list applies an inclusive date window', async () => {
    query.mockResolvedValue({ rows: [row()] })
    await list({ from: '2026-09-01', to: '2026-09-30' })
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('date >= ')
    expect(sql).toContain('date <= ')
  })

  it('list without filters runs an unfiltered ORDER BY date', async () => {
    query.mockResolvedValue({ rows: [] })
    await list()
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).not.toContain('WHERE')
    expect(sql).toContain('ORDER BY date')
  })

  it('create rejects a duplicate date with 409', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    await expect(create({ name: 'X', date: '2026-09-01' })).rejects.toMatchObject({ status: 409 })
  })

  it('create inserts and returns the joined holiday', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [{ id: 7 }] })
    query.mockResolvedValueOnce({ rows: [row({ id: 7 })] })
    const h = await create({ name: 'Day', date: '2026-09-17' })
    expect(h.id).toBe(7)
    const insertSql = query.mock.calls[1]?.[0] as string
    expect(insertSql).toContain('INSERT INTO holidays')
  })

  it('update 404 when missing; 409 on dup date', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(update(99, { name: 'X' })).rejects.toMatchObject({ status: 404 })

    query.mockReset()
    query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'Old', date: '2026-09-01' }] })
    query.mockResolvedValueOnce({ rows: [{ id: 2 }] })
    await expect(update(1, { date: '2026-09-17' })).rejects.toMatchObject({ status: 409 })
  })

  it('remove deletes; 404 when missing', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    query.mockResolvedValueOnce({ rows: [] })
    await remove(1)
    expect((query.mock.calls[1]?.[0] as string).includes('DELETE FROM holidays')).toBe(true)

    query.mockReset()
    query.mockResolvedValue({ rows: [] })
    await expect(remove(99)).rejects.toMatchObject({ status: 404 })
  })
})
