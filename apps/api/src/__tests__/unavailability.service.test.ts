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

import {
  create,
  createOwn,
  listAll,
  listOwn,
  remove,
  update,
} from '../services/unavailability.service'

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    doctor_id: 5,
    first_name: 'Jane',
    last_name: 'Roe',
    type: 'vacation',
    start_date: '2026-09-07',
    end_date: '2026-09-11',
    note: null,
    created_at: new Date('2026-09-01'),
    updated_at: new Date('2026-09-01'),
    ...overrides,
  }
}

beforeEach(() => {
  query.mockReset()
  logActivity.mockReset()
  recordActivity.mockReset()
})

describe('unavailability.service', () => {
  it('listAll with no filters runs an unfiltered SELECT', async () => {
    query.mockResolvedValue({ rows: [row()] })
    const xs = await listAll()
    expect(xs).toHaveLength(1)
    expect(xs[0]?.doctorId).toBe(5)
    expect(typeof xs[0]?.startDate).toBe('string')
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).not.toContain('WHERE')
  })

  it('listAll with doctorId + date window emits WHERE clauses', async () => {
    query.mockResolvedValue({ rows: [] })
    await listAll({ doctorId: 5, from: '2026-09-01', to: '2026-09-30' })
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('x.doctor_id')
    expect(sql).toContain('x.start_date <=')
    expect(sql).toContain('x.end_date >=')
  })

  it('listOwn resolves doctorId then lists (404 when no profile)', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(listOwn(9)).rejects.toMatchObject({ status: 404 })
  })

  it('create rejects unknown doctor with 404', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(
      create(99, { type: 'sick', startDate: '2026-09-01', endDate: '2026-09-01' }, {
        id: 2,
        role: 'administrator',
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('create rejects overlap with 409 then inserts when clear', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    query.mockResolvedValueOnce({ rows: [{ id: 99 }] })
    await expect(
      create(5, { type: 'vacation', startDate: '2026-09-08', endDate: '2026-09-09' }, {
        id: 2,
        role: 'administrator',
      }),
    ).rejects.toMatchObject({ status: 409 })

    query.mockReset()
    let n = 0
    query.mockImplementation(async () => {
      n++
      if (n === 1) return { rows: [{ id: 1 }] }
      if (n === 2) return { rows: [] }
      if (n === 3) return { rows: [{ id: 7 }] }
      return { rows: [row({ id: 7 })] }
    })
    const x = await create(
      5,
      { type: 'vacation', startDate: '2026-09-20', endDate: '2026-09-21' },
      { id: 2, role: 'administrator' },
    )
    expect(x.id).toBe(7)
    const insertSql = query.mock.calls[2]?.[0] as string
    expect(insertSql).toContain('INSERT INTO unavailability')
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'availability.created', entityId: 7 }),
    )
  })

  it('createOwn resolves doctorId then creates', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 5 }] })
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [{ id: 9 }] })
    query.mockResolvedValueOnce({ rows: [row({ id: 9 })] })
    const x = await createOwn(10, { type: 'sick', startDate: '2026-09-01', endDate: '2026-09-02' })
    expect(x.id).toBe(9)
  })

  it('update excludes self from overlap check and clears note on null', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          doctor_id: 5,
          type: 'vacation',
          start_date: '2026-09-07',
          end_date: '2026-09-11',
          note: 'old',
        },
      ],
    })
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [row({ note: null })] })
    const x = await update(
      1,
      { note: null, endDate: '2026-09-12' },
      { id: 1, role: 'administrator' },
    )
    expect(x.note).toBeNull()
    const overlapSql = query.mock.calls[2]?.[0] as string
    expect(overlapSql).toContain('AND id <>')
    const updateSql = query.mock.calls[3]?.[0] as string
    expect(updateSql).toContain('UPDATE unavailability')
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'availability.updated', entityId: 1 }),
    )
  })

  it('update forbids a non-owner doctor (403); superadmin treated as admin', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          doctor_id: 5,
          type: 'vacation',
          start_date: '2026-09-07',
          end_date: '2026-09-11',
          note: null,
        },
      ],
    })
    query.mockResolvedValueOnce({ rows: [{ id: 8 }] })
    await expect(
      update(1, { type: 'sick' }, { id: 10, role: 'doctor' }),
    ).rejects.toMatchObject({ status: 403 })

    query.mockReset()
    query.mockResolvedValueOnce({
      rows: [
        {
          doctor_id: 5,
          type: 'vacation',
          start_date: '2026-09-07',
          end_date: '2026-09-11',
          note: null,
        },
      ],
    })
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [row({ type: 'sick' })] })
    const x = await update(1, { type: 'sick' }, { id: 1, role: 'superadmin' })
    expect(x.type).toBe('sick')
  })

  it('update skips the audit row when nothing changed', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          doctor_id: 5,
          type: 'vacation',
          start_date: '2026-09-07',
          end_date: '2026-09-11',
          note: null,
        },
      ],
    })
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [row()] })
    const x = await update(1, { note: null }, { id: 1, role: 'administrator' })
    expect(x.note).toBeNull()
    expect(recordActivity).not.toHaveBeenCalled()
  })

  it('update 404 when record missing', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(
      update(99, { type: 'sick' }, { id: 1, role: 'administrator' }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('remove deletes the row; 404 when missing; 403 for non-owner', async () => {
    query.mockResolvedValueOnce({
      rows: [{ doctor_id: 5, type: 'vacation', start_date: '2026-09-07', end_date: '2026-09-11' }],
    })
    query.mockResolvedValueOnce({ rows: [] })
    await remove(1, { id: 1, role: 'administrator' })
    const del = query.mock.calls[1]?.[0] as string
    expect(del).toContain('DELETE FROM unavailability')
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'availability.deleted', entityId: 1 }),
    )

    query.mockReset()
    logActivity.mockReset()
    query.mockResolvedValue({ rows: [] })
    await expect(remove(99, { id: 1, role: 'administrator' })).rejects.toMatchObject({
      status: 404,
    })

    query.mockReset()
    query.mockResolvedValueOnce({
      rows: [{ doctor_id: 5, type: 'vacation', start_date: '2026-09-07', end_date: '2026-09-11' }],
    })
    query.mockResolvedValueOnce({ rows: [{ id: 8 }] })
    await expect(remove(1, { id: 10, role: 'doctor' })).rejects.toMatchObject({ status: 403 })
  })
})
