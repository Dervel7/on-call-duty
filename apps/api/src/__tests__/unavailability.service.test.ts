import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
type Work = (c: { query: typeof query }) => Promise<unknown>
const transaction = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: Work) => transaction(work),
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
  setDisabled,
  split,
  update,
} from '../services/unavailability.service'
import type { ClinicScope } from '../lib/scope'

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    doctor_id: 5,
    first_name: 'Jane',
    last_name: 'Roe',
    start_date: '2026-09-07',
    end_date: '2026-09-11',
    is_disabled: false,
    created_at: new Date('2026-09-01'),
    updated_at: new Date('2026-09-01'),
    ...overrides,
  }
}

const stored = () => ({
  doctor_id: 5,
  clinic_id: 1,
  start_date: '2026-09-07',
  end_date: '2026-09-11',
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
  transaction.mockReset()
  transaction.mockImplementation((work: Work) => work({ query }))
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
      create(99, { startDate: '2026-09-01', endDate: '2026-09-01' }, admin),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('create with a scope 404s for a cross-clinic doctor (I13)', async () => {
    query.mockResolvedValueOnce({ rows: [] }) // lock finds no doctor in scope
    await expect(
      create(
        5,
        { startDate: '2026-09-01', endDate: '2026-09-01' },
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
      create(5, { startDate: '2026-09-08', endDate: '2026-09-09' }, admin),
    ).rejects.toMatchObject({ status: 409 })

    query.mockReset()
    installDb()
    const x = await create(
      5,
      { startDate: '2026-09-20', endDate: '2026-09-21' },
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
  const x = await createOwn(10, { startDate: '2026-09-01', endDate: '2026-09-02' })
    expect(x.id).toBe(1)
  })

  it('update excludes self from the overlap check', async () => {
    installDb()
    const x = await update(1, { endDate: '2026-09-12' }, admin)
    expect(x.id).toBe(1)
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
      return { rows: [row()] }
    })
    await expect(update(1, {}, doctor)).rejects.toMatchObject({ status: 403 })
    await expect(update(1, {}, manager)).rejects.toMatchObject({ status: 403 })

    query.mockReset()
    installDb()
    const x = await update(1, { endDate: '2026-09-12' }, superadmin)
    expect(x.id).toBe(1)
  })

  it('update hides a cross-clinic record from an administrator (404)', async () => {
    query.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? '')
      if (sql.includes('JOIN doctors d ON d.id = x.doctor_id')) return { rows: [stored()] }
      if (sql.includes('FROM doctors WHERE id = $1 AND clinic_id = $2')) return { rows: [] }
      return { rows: [] }
    })
    await expect(update(1, {}, admin)).rejects.toMatchObject({ status: 404 })
  })

  it('update skips the audit row when nothing changed', async () => {
    installDb()
    const x = await update(1, {}, admin)
    expect(x.id).toBe(1)
    expect(recordActivity).not.toHaveBeenCalled()
  })

  it('update 404 when record missing', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(update(99, {}, admin)).rejects.toMatchObject({ status: 404 })
  })

  it('setDisabled updates the flag and logs availability.updated (administrator)', async () => {
    query.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? '')
      if (sql.includes('d.clinic_id')) return { rows: [{ ...stored(), is_disabled: false }] }
      if (sql.includes('FROM doctors WHERE id = $1 AND clinic_id = $2')) return { rows: [{ 1: 1 }] }
      if (sql.includes('FOR UPDATE')) return { rows: [{ doctor_id: 5, is_disabled: false }] }
      if (sql.includes('UPDATE unavailability')) return { rows: [] }
      return { rows: [row({ is_disabled: true })] }
    })
    const x = await setDisabled(1, true, admin)
    expect(x.id).toBe(1)
    const updateSql = query.mock.calls.find((c) => String(c[0]).includes('UPDATE unavailability'))
    expect(String(updateSql?.[0])).toContain('SET is_disabled = $1')
    expect(updateSql?.[1]).toEqual([true, 1])
    expect(recordActivity).toHaveBeenCalledTimes(1)
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'availability.updated',
        entityType: 'unavailability',
        entityId: 1,
        clinicId: 1,
        detail: { doctorId: 5, before: { isDisabled: false }, after: { isDisabled: true } },
      }),
    )
  })

  it('setDisabled forbids doctors even on their own record (403)', async () => {
    installDb()
    await expect(setDisabled(1, true, doctor)).rejects.toMatchObject({ status: 403 })
    expect(query).not.toHaveBeenCalled()
  })

  it('setDisabled forbids managers (403)', async () => {
    await expect(setDisabled(1, true, manager)).rejects.toMatchObject({ status: 403 })
  })

  it('setDisabled 404 when record missing', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(setDisabled(99, true, admin)).rejects.toMatchObject({ status: 404 })
  })

  it('setDisabled hides a cross-clinic record from an administrator (404)', async () => {
    query.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? '')
      if (sql.includes('d.clinic_id')) return { rows: [{ ...stored(), is_disabled: false }] }
      if (sql.includes('FROM doctors WHERE id = $1 AND clinic_id = $2')) return { rows: [] }
      return { rows: [] }
    })
    await expect(setDisabled(1, true, admin)).rejects.toMatchObject({ status: 404 })
  })

  it('setDisabled skips the UPDATE and activity when the state already matches', async () => {
    query.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? '')
      if (sql.includes('d.clinic_id')) return { rows: [{ ...stored(), is_disabled: true }] }
      if (sql.includes('FROM doctors WHERE id = $1 AND clinic_id = $2')) return { rows: [{ 1: 1 }] }
      if (sql.includes('FOR UPDATE')) return { rows: [{ doctor_id: 5, is_disabled: true }] }
      return { rows: [row({ is_disabled: true })] }
    })
    const x = await setDisabled(1, true, admin)
    expect(x.id).toBe(1)
    expect(query.mock.calls.some((c) => String(c[0]).includes('UPDATE unavailability'))).toBe(false)
    expect(recordActivity).not.toHaveBeenCalled()
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

  describe('split', () => {
    interface Row {
      id: number
      doctor_id: number
      [column: string]: unknown
    }
    let table: Map<number, Row>

    // In-memory unavailability table. withTransaction snapshots it and restores
    // the snapshot on error, mirroring the real BEGIN/ROLLBACK semantics.
    function installSplitDb(isDisabled: boolean, failOnInsert?: number) {
      table = new Map([[1, row({ is_disabled: isDisabled })]])
      let nextId = 7
      let inserts = 0
      transaction.mockImplementation(async (work: Work) => {
        const snapshot = new Map([...table].map(([k, v]) => [k, { ...v }]))
        try {
          return await work({ query })
        } catch (err) {
          table = snapshot
          throw err
        }
      })
      query.mockImplementation(async (sql: string, params: unknown[] = []) => {
        if (sql.includes('x.id = ANY($1')) {
          const ids = params[0] as number[]
          return { rows: [...table.values()].filter((r) => ids.includes(r.id)) }
        }
        if (sql.includes('SELECT x.doctor_id, d.clinic_id')) {
          const r = table.get(params[0] as number)
          return { rows: r ? [{ doctor_id: r.doctor_id, clinic_id: 1 }] : [] }
        }
        if (sql.includes('FROM doctors WHERE id = $1 AND clinic_id = $2')) return { rows: [{ 1: 1 }] }
        if (sql.includes('FROM doctors WHERE user_id = $1')) return { rows: [{ id: 5 }] }
        if (sql.includes('SELECT 1 FROM doctors WHERE id = $1 FOR UPDATE')) return { rows: [{ 1: 1 }] }
        if (sql.includes('FROM unavailability WHERE id = $1 FOR UPDATE')) {
          const r = table.get(params[0] as number)
          return { rows: r ? [r] : [] }
        }
        if (sql.includes('UPDATE unavailability')) {
          const [startDate, endDate, disabled, id] = params as [string, string, boolean, number]
          const r = table.get(id)!
          table.set(id, { ...r, start_date: startDate, end_date: endDate, is_disabled: disabled })
          return { rows: [] }
        }
        if (sql.includes('INSERT INTO unavailability')) {
          inserts += 1
          if (inserts === failOnInsert) throw new Error('insert failed')
          const [doctorId, startDate, endDate, disabled] = params as [number, string, string, boolean]
          const id = nextId++
          table.set(id, row({ id, doctor_id: doctorId, start_date: startDate, end_date: endDate, is_disabled: disabled }))
          return { rows: [{ id }] }
        }
        return { rows: [] }
      })
    }

    const middleOut = [
      { startDate: '2026-09-07', endDate: '2026-09-08' },
      { startDate: '2026-09-10', endDate: '2026-09-11' },
    ]

    it('cuts a middle day out: kept record shrinks, new record carries the disabled flag', async () => {
      installSplitDb(true)
      const xs = await split(1, { segments: middleOut }, admin)
      expect(xs.map((x) => [x.id, x.startDate, x.endDate, x.isDisabled])).toEqual([
        [1, '2026-09-07', '2026-09-08', true],
        [7, '2026-09-10', '2026-09-11', true],
      ])
      expect(table.size).toBe(2)
      expect(recordActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'availability.updated',
          entityId: 1,
          detail: { doctorId: 5, before: { endDate: '2026-09-11' }, after: { endDate: '2026-09-08' } },
        }),
      )
      expect(recordActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'availability.created', entityId: 7 }),
      )
    })

    it('a doctor may split their own disabled record; the days stay disabled', async () => {
      installSplitDb(true)
      const xs = await split(1, { segments: middleOut }, doctor)
      expect(xs.map((x) => x.isDisabled)).toEqual([true, true])
    })

    it('isDisabled flips only the record that keeps the id', async () => {
      installSplitDb(true)
      const xs = await split(1, { segments: middleOut, isDisabled: false }, admin)
      expect(xs.map((x) => [x.id, x.isDisabled])).toEqual([
        [1, false],
        [7, true],
      ])
    })

    it('keeps the id on segments[0] as sent, even when it is not the earliest (page toggle payload)', async () => {
      installSplitDb(false)
      const xs = await split(
        1,
        {
          segments: [
            { startDate: '2026-09-09', endDate: '2026-09-09' },
            { startDate: '2026-09-07', endDate: '2026-09-08' },
            { startDate: '2026-09-10', endDate: '2026-09-11' },
          ],
          isDisabled: true,
        },
        admin,
      )
      expect(xs.map((x) => [x.id, x.startDate, x.endDate, x.isDisabled])).toEqual([
        [1, '2026-09-09', '2026-09-09', true],
        [7, '2026-09-07', '2026-09-08', false],
        [8, '2026-09-10', '2026-09-11', false],
      ])
    })

    it('rejects segments outside the record or overlapping each other (400) without writing', async () => {
      installSplitDb(false)
      await expect(
        split(1, { segments: [{ startDate: '2026-09-06', endDate: '2026-09-08' }] }, admin),
      ).rejects.toMatchObject({ status: 400 })
      await expect(
        split(
          1,
          {
            segments: [
              { startDate: '2026-09-07', endDate: '2026-09-09' },
              { startDate: '2026-09-09', endDate: '2026-09-11' },
            ],
          },
          admin,
        ),
      ).rejects.toMatchObject({ status: 400 })
      expect(query.mock.calls.some((c) => /^(UPDATE|INSERT)/.test(String(c[0])))).toBe(false)
    })

    it('rolls everything back when a later insert fails', async () => {
      installSplitDb(false, 2)
      const original = { ...table.get(1)! }
      await expect(
        split(
          1,
          {
            segments: [
              { startDate: '2026-09-07', endDate: '2026-09-07' },
              { startDate: '2026-09-09', endDate: '2026-09-09' },
              { startDate: '2026-09-11', endDate: '2026-09-11' },
            ],
          },
          admin,
        ),
      ).rejects.toThrow('insert failed')
      expect([...table.values()]).toEqual([original])
    })

    it('doctor passing isDisabled is 403; manager 403; missing record 404', async () => {
      installSplitDb(true)
      await expect(split(1, { segments: middleOut, isDisabled: false }, doctor)).rejects.toMatchObject({
        status: 403,
      })
      expect(query).not.toHaveBeenCalled()
      await expect(split(1, { segments: middleOut }, manager)).rejects.toMatchObject({ status: 403 })
      await expect(split(99, { segments: middleOut }, admin)).rejects.toMatchObject({ status: 404 })
    })
  })
})
