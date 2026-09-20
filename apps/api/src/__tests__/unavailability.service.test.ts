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
import type { ClinicScope } from '../lib/scope'

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

const stored = () => ({
  doctor_id: 5,
  clinic_id: 1,
  type: 'vacation',
  start_date: '2026-09-07',
  end_date: '2026-09-11',
  note: null as string | null,
})

// SQL-keyed routing keeps sequences stable as intermediate queries evolve.
function installDb(rows: Record<string, unknown>[] = [row()]) {
  query.mockImplementation(async (...args: unknown[]) => {
    const sql = String(args[0] ?? '')
    if (sql.includes('JOIN doctors d ON d.id = x.doctor_id')) return { rows }
    if (sql.includes('FROM doctors WHERE id = $1 AND clinic_id = $2')) return { rows: [{ 1: 1 }] }
    if (sql.includes('FOR UPDATE OF d')) return { rows: [{ clinic_id: 1 }] }
    if (sql.includes('FROM doctors WHERE user_id = $1')) return { rows: [{ id: 5 }] }
    if (sql.includes('SELECT id FROM unavailability WHERE doctor_id')) return { rows: [] }
    if (sql.includes('INSERT INTO unavailability')) return { rows: [{ id: 7 }] }
    if (sql.includes('UPDATE unavailability')) return { rows: [] }
    if (sql.includes('DELETE FROM unavailability')) return { rows: [{ id: 1 }] }
    if (sql.includes('SELECT 1 FROM doctors WHERE id = $1 FOR UPDATE')) return { rows: [{ 1: 1 }] }
    return { rows }
  })
}

beforeEach(() => {
  query.mockReset()
  logActivity.mockReset()
  recordActivity.mockReset()
})

describe('unavailability.service', () => {
  const scope = (clinicId: number): ClinicScope => ({ kind: 'clinic', clinicId })
  const admin = { id: 2, role: 'administrator' as const, clinicId: 1 }
  const manager = { id: 5, role: 'manager' as const, clinicId: null }
  const superadmin = { id: 3, role: 'superadmin' as const, clinicId: null }
  const doctor = { id: 10, role: 'doctor' as const, clinicId: null }

  it('listAll with no filters runs an unfiltered SELECT', async () => {
    query.mockResolvedValue({ rows: [row()] })
    const xs = await listAll()
    expect(xs).toHaveLength(1)
    expect(xs[0]?.doctorId).toBe(5)
    expect(typeof xs[0]?.startDate).toBe('string')
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).not.toContain('WHERE')
  })

  it('listAll with a scope filters through the doctor clinic (I12)', async () => {
    query.mockResolvedValue({ rows: [row()] })
    await listAll({}, scope(1))
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('d.clinic_id = $1')
    expect(query.mock.calls[0]?.[1]).toEqual([1])
  })

  it('listAll with doctorId + date window emits WHERE clauses', async () => {
    query.mockResolvedValue({ rows: [] })
    await listAll({ doctorId: 5, from: '2026-09-01', to: '2026-09-30' }, scope(1))
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('d.clinic_id')
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
      create(99, { type: 'sick', startDate: '2026-09-01', endDate: '2026-09-01' }, admin),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('create with a scope 404s for a cross-clinic doctor (I13)', async () => {
    query.mockResolvedValueOnce({ rows: [] }) // lock finds no doctor in scope
    await expect(
      create(
        5,
        { type: 'sick', startDate: '2026-09-01', endDate: '2026-09-01' },
        admin,
        scope(1),
      ),
    ).rejects.toMatchObject({ status: 404 })
    const lock = query.mock.calls[0]?.[0] as string
    expect(lock).toContain('d.clinic_id = $2')
    expect(query.mock.calls[0]?.[1]).toEqual([5, 1])
  })

  it('create rejects overlap with 409 then inserts when clear', async () => {
    query.mockResolvedValueOnce({ rows: [{ clinic_id: 1 }] })
    query.mockResolvedValueOnce({ rows: [{ id: 99 }] })
    await expect(
      create(5, { type: 'vacation', startDate: '2026-09-08', endDate: '2026-09-09' }, admin),
    ).rejects.toMatchObject({ status: 409 })

    query.mockReset()
    installDb()
    const x = await create(
      5,
      { type: 'vacation', startDate: '2026-09-20', endDate: '2026-09-21' },
      admin,
      scope(1),
    )
    expect(x.id).toBe(1)
    const insert = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO unavailability'))
    expect(String(insert?.[0])).toContain('INSERT INTO unavailability')
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'availability.created', entityId: 7, clinicId: 1 }),
    )
  })

  it('createOwn resolves doctorId then creates', async () => {
    installDb()
    const x = await createOwn(10, { type: 'sick', startDate: '2026-09-01', endDate: '2026-09-02' })
    expect(x.id).toBe(1)
  })

  it('update excludes self from overlap check and clears note on null', async () => {
    installDb([row({ note: null })])
    const x = await update(1, { note: null, endDate: '2026-09-12' }, admin)
    expect(x.note).toBeNull()
    const overlap = query.mock.calls.find((c) => String(c[0]).includes('AND id <>'))
    expect(String(overlap?.[0])).toContain('AND id <>')
    const updateSql = query.mock.calls.find((c) => String(c[0]).includes('UPDATE unavailability'))
    expect(String(updateSql?.[0])).toContain('UPDATE unavailability')
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'availability.updated', entityId: 1 }),
    )
  })

  it('update rejects a partial date patch that inverts the stored range (400)', async () => {
    query.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? '')
      if (sql.includes('JOIN doctors d ON d.id = x.doctor_id')) {
        return { rows: [{ ...stored(), start_date: '2026-09-20', end_date: '2026-09-11' }] }
      }
      if (sql.includes('FROM doctors WHERE id = $1 AND clinic_id = $2')) return { rows: [{ 1: 1 }] }
      if (sql.includes('FOR UPDATE')) return { rows: [{ ...stored(), start_date: '2026-09-20', end_date: '2026-09-11' }] }
      return { rows: [] }
    })
    await expect(update(1, { startDate: '2026-09-20' }, admin)).rejects.toMatchObject({
      status: 400,
    })
  })

  it('update forbids a non-owner doctor (403); superadmin passes; manager is 403', async () => {
    query.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? '')
      if (sql.includes('JOIN doctors d ON d.id = x.doctor_id')) return { rows: [stored()] }
      if (sql.includes('FROM doctors WHERE user_id = $1')) return { rows: [{ id: 8 }] }
      return { rows: [row({ type: 'sick' })] }
    })
    await expect(update(1, { type: 'sick' }, doctor)).rejects.toMatchObject({ status: 403 })
    await expect(update(1, { type: 'sick' }, manager)).rejects.toMatchObject({ status: 403 })

    query.mockReset()
    installDb([row({ type: 'sick' })])
    const x = await update(1, { type: 'sick' }, superadmin)
    expect(x.type).toBe('sick')
  })

  it('update hides a cross-clinic record from an administrator (404)', async () => {
    query.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? '')
      if (sql.includes('JOIN doctors d ON d.id = x.doctor_id')) return { rows: [stored()] }
      if (sql.includes('FROM doctors WHERE id = $1 AND clinic_id = $2')) return { rows: [] }
      return { rows: [] }
    })
    await expect(update(1, { type: 'sick' }, admin)).rejects.toMatchObject({ status: 404 })
  })

  it('update skips the audit row when nothing changed', async () => {
    installDb()
    const x = await update(1, { note: null }, admin)
    expect(x.note).toBeNull()
    expect(recordActivity).not.toHaveBeenCalled()
  })

  it('update 404 when record missing', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(update(99, { type: 'sick' }, admin)).rejects.toMatchObject({ status: 404 })
  })

  it('remove deletes the row; 404 when missing; 403 for non-owner; 404 cross-clinic', async () => {
    installDb()
    await remove(1, admin)
    const del = query.mock.calls.find((c) => String(c[0]).includes('DELETE FROM unavailability'))
    expect(String(del?.[0])).toContain('DELETE FROM unavailability')
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'availability.deleted', entityId: 1 }),
    )

    query.mockResolvedValue({ rows: [] })
    await expect(remove(99, admin)).rejects.toMatchObject({ status: 404 })

    query.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? '')
      if (sql.includes('JOIN doctors d ON d.id = x.doctor_id')) return { rows: [stored()] }
      if (sql.includes('FROM doctors WHERE user_id = $1')) return { rows: [{ id: 8 }] }
      return { rows: [] }
    })
    await expect(remove(1, doctor)).rejects.toMatchObject({ status: 403 })

    query.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? '')
      if (sql.includes('JOIN doctors d ON d.id = x.doctor_id')) return { rows: [stored()] }
      if (sql.includes('FROM doctors WHERE id = $1 AND clinic_id = $2')) return { rows: [] }
      return { rows: [] }
    })
    await expect(remove(1, admin)).rejects.toMatchObject({ status: 404 })
  })
})
