import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

import {
  addDuty,
  generate,
  getById,
  list,
  preview,
  reassignDuty,
  remove,
  removeDuty,
} from '../services/schedule.service'

function scheduleRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    year: 2026,
    month: 9,
    status: 'draft',
    created_by: 2,
    created_at: new Date('2026-08-01'),
    updated_at: new Date('2026-08-01'),
    ...overrides,
  }
}
function dutyRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 10,
    schedule_id: 1,
    duty_date: '2026-09-05',
    doctor_id: 5,
    first_name: 'Jane',
    last_name: 'Roe',
    is_weekend: false,
    is_holiday: false,
    reason: 'score 1 (workload +1, weekend +0, holiday +0)',
    created_at: new Date('2026-08-01'),
    ...overrides,
  }
}

beforeEach(() => query.mockReset())

describe('schedule.service', () => {
  it('generate 409 when the month already exists', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    await expect(generate(2026, 9, { id: 2, role: 'administrator' })).rejects.toMatchObject({
      status: 409,
    })
  })

  it('generate 422 when a day is unfillable (no doctors) and persists nothing', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(generate(2026, 9, { id: 2, role: 'administrator' })).rejects.toMatchObject({
      status: 422,
    })
    expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO schedules'))).toBe(false)
  })

  it('generate persists a schedule + duties when every day is fillable', async () => {
    const doctors = [
      { id: 1, max_monthly_duties: 7, first_name: 'A', last_name: 'A', is_active: true },
      { id: 2, max_monthly_duties: 7, first_name: 'B', last_name: 'B', is_active: true },
      { id: 3, max_monthly_duties: 7, first_name: 'C', last_name: 'C', is_active: true },
      { id: 4, max_monthly_duties: 7, first_name: 'D', last_name: 'D', is_active: true },
      { id: 5, max_monthly_duties: 7, first_name: 'E', last_name: 'E', is_active: true },
    ]
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM schedules') && sql.includes('year =')) return { rows: [] }
      if (sql.includes('FROM doctors d JOIN users')) return { rows: doctors }
      if (sql.includes('FROM holidays')) return { rows: [] }
      if (sql.includes('FROM unavailability')) return { rows: [] }
      if (sql.includes('FROM duties WHERE duty_date =')) return { rows: [] }
      if (sql.includes('INSERT INTO schedules')) return { rows: [{ id: 42 }] }
      if (sql.includes('INSERT INTO duties')) return { rows: [] }
      if (sql.includes('FROM schedules') && sql.includes('WHERE id =')) {
        return { rows: [scheduleRow({ id: 42 })] }
      }
      if (sql.includes('FROM duties du')) return { rows: [] }
      return { rows: [] }
    })
    const detail = await generate(2026, 9, { id: 2, role: 'administrator' })
    expect(detail.schedule.id).toBe(42)
    expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO schedules'))).toBe(true)
    expect(query.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO duties')).length).toBeGreaterThan(0)
  })

  it('preview returns assignments + conflicts without persisting', async () => {
    query.mockResolvedValue({ rows: [] })
    const res = await preview(2026, 9)
    expect(Array.isArray(res.assignments)).toBe(true)
    expect(Array.isArray(res.conflicts)).toBe(true)
    expect(query.mock.calls.some((c) => String(c[0]).startsWith('INSERT'))).toBe(false)
  })

  it('list applies optional year/month filters', async () => {
    query.mockResolvedValue({ rows: [scheduleRow()] })
    await list({ year: 2026, month: 9 })
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('year =')
    expect(sql).toContain('month =')
  })

  it('getById 404 when missing', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(getById(99)).rejects.toMatchObject({ status: 404 })
  })

  it('remove deletes the schedule (404 when missing)', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    query.mockResolvedValueOnce({ rows: [] })
    await remove(1)
    expect((query.mock.calls[1]?.[0] as string).includes('DELETE FROM schedules')).toBe(true)

    query.mockReset()
    query.mockResolvedValue({ rows: [] })
    await expect(remove(99)).rejects.toMatchObject({ status: 404 })
  })

  it('addDuty rejects an out-of-month date with 400', async () => {
    query.mockResolvedValueOnce({ rows: [scheduleRow()] })
    await expect(
      addDuty(1, { date: '2026-10-05', doctorId: 5 }, { id: 2, role: 'administrator' }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('addDuty rejects an already-filled date with 409', async () => {
    query.mockResolvedValueOnce({ rows: [scheduleRow()] })
    query.mockResolvedValueOnce({ rows: [{ id: 9 }] })
    await expect(
      addDuty(1, { date: '2026-09-05', doctorId: 5 }, { id: 2, role: 'administrator' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('reassignDuty runs validateAssignment and updates the row', async () => {
    query.mockResolvedValueOnce({ rows: [dutyRow({ id: 10, doctor_id: 5, duty_date: '2026-09-05' })] })
    query.mockResolvedValueOnce({ rows: [{ max_monthly_duties: 7, is_active: true }] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [{ n: 0 }] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [dutyRow({ id: 10, doctor_id: 7, reason: 'manual override by admin #2' })] })
    const d = await reassignDuty(10, { doctorId: 7 }, { id: 2, role: 'administrator' })
    expect(d.doctorId).toBe(7)
    expect(d.reason).toContain('manual override by admin #2')
  })

  it('reassignDuty 404 when duty missing', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(
      reassignDuty(99, { doctorId: 7 }, { id: 2, role: 'administrator' }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('removeDuty deletes; 404 when missing', async () => {
    query.mockResolvedValueOnce({ rows: [dutyRow()] })
    query.mockResolvedValueOnce({ rows: [] })
    await removeDuty(10)
    expect((query.mock.calls[1]?.[0] as string).includes('DELETE FROM duties')).toBe(true)

    query.mockReset()
    query.mockResolvedValue({ rows: [] })
    await expect(removeDuty(99)).rejects.toMatchObject({ status: 404 })
  })
})
