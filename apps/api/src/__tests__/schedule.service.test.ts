import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

import {
  addDuty,
  computeEligibility,
  generate,
  getById,
  list,
  preview,
  publish,
  reassignDuty,
  remove,
  removeDuty,
  unpublish,
} from '../services/schedule.service'
import type { DoctorSpec } from '../scheduling/types'

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
    reason: 'score 1 (workload +1, weekend +0, holiday +0, friday +0)',
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
    const doctors = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      max_monthly_duties: 7,
      first_name: `D${i + 1}`,
      last_name: `D${i + 1}`,
      is_active: true,
    }))
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

  it('addDuty rejects a date with both slots filled (409)', async () => {
    query.mockResolvedValueOnce({ rows: [scheduleRow()] })
    query.mockResolvedValueOnce({ rows: [{ n: 2 }] })
    await expect(
      addDuty(1, { date: '2026-09-05', doctorId: 5 }, { id: 2, role: 'administrator' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('addDuty 409 when the same doctor is already assigned to the date', async () => {
    query.mockResolvedValueOnce({ rows: [scheduleRow()] })
    query.mockResolvedValueOnce({ rows: [{ n: 1 }] })
    query.mockResolvedValueOnce({ rows: [{ max_monthly_duties: 7, is_active: true }] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [{ n: 0 }] })
    query.mockResolvedValueOnce({ rows: [{ n: 1 }] })
    await expect(
      addDuty(1, { date: '2026-09-05', doctorId: 5 }, { id: 2, role: 'administrator' }),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('already assigned to this date'),
    })
  })

  it('reassignDuty runs validateAssignment and updates the row', async () => {
    query.mockResolvedValueOnce({ rows: [dutyRow({ id: 10, doctor_id: 5, duty_date: '2026-09-05' })] })
    query.mockResolvedValueOnce({ rows: [{ max_monthly_duties: 7, is_active: true }] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [{ n: 0 }] })
    query.mockResolvedValueOnce({ rows: [{ n: 0 }] })
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

describe('generate plan path', () => {
  const doctors = Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    max_monthly_duties: 7,
    first_name: `D${i + 1}`,
    last_name: `D${i + 1}`,
    is_active: true,
  }))

  function mockContext() {
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM schedules') && sql.includes('year =')) return { rows: [] }
      if (sql.includes('FROM doctors d JOIN users')) return { rows: doctors }
      if (sql.includes('FROM holidays')) return { rows: [] }
      if (sql.includes('FROM unavailability')) return { rows: [] }
      if (sql.includes('FROM duties WHERE duty_date =')) return { rows: [] }
      if (sql.includes('INSERT INTO schedules')) return { rows: [{ id: 7 }] }
      if (sql.includes('INSERT INTO duties')) return { rows: [] }
      if (sql.includes('FROM schedules') && sql.includes('WHERE id =')) {
        return { rows: [scheduleRow({ id: 7 })] }
      }
      if (sql.includes('FROM duties du')) return { rows: [] }
      return { rows: [] }
    })
  }

  it('persists a valid 1-doctor-per-day plan (relaxed rule)', async () => {
    mockContext()
    const assignments = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      doctorId: (i % 12) + 1,
      reason: 'manual override',
    }))
    const detail = await generate(2026, 9, { id: 2, role: 'administrator' }, assignments)
    expect(detail.schedule.id).toBe(7)
    const inserts = query.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO duties'))
    expect(inserts.length).toBe(30)
  })

  it('422 when any day has no doctor', async () => {
    mockContext()
    const assignments = Array.from({ length: 29 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      doctorId: (i % 12) + 1,
    }))
    await expect(
      generate(2026, 9, { id: 2, role: 'administrator' }, assignments),
    ).rejects.toMatchObject({ status: 422 })
    expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO schedules'))).toBe(false)
  })

  it('409 when a doctor is on vacation that date (availability is hard)', async () => {
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM schedules') && sql.includes('year =')) return { rows: [] }
      if (sql.includes('FROM doctors d JOIN users')) return { rows: doctors }
      if (sql.includes('FROM holidays')) return { rows: [] }
      if (sql.includes('FROM unavailability'))
        return { rows: [{ doctor_id: 1, start_date: '2026-09-01', end_date: '2026-09-30' }] }
      if (sql.includes('FROM duties WHERE duty_date =')) return { rows: [] }
      return { rows: [] }
    })
    const assignments = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      doctorId: 1,
    }))
    await expect(
      generate(2026, 9, { id: 2, role: 'administrator' }, assignments),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('409 when the same doctor is assigned twice on a date', async () => {
    mockContext()
    const assignments = [
      { date: '2026-09-01', doctorId: 1 },
      { date: '2026-09-01', doctorId: 1 },
    ]
    await expect(
      generate(2026, 9, { id: 2, role: 'administrator' }, assignments),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('409 when a date has more than 2 doctors', async () => {
    mockContext()
    const assignments = [
      { date: '2026-09-01', doctorId: 1 },
      { date: '2026-09-01', doctorId: 2 },
      { date: '2026-09-01', doctorId: 3 },
    ]
    await expect(
      generate(2026, 9, { id: 2, role: 'administrator' }, assignments),
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('publish / unpublish', () => {
  it('publish flips draft->published; 404 missing; 409 already published', async () => {
    query.mockResolvedValueOnce({ rows: [scheduleRow({ status: 'published' })] })
    const published = await publish(1)
    expect(published.status).toBe('published')

    query.mockResolvedValueOnce({ rows: [] }) // UPDATE matches nothing
    query.mockResolvedValueOnce({ rows: [] }) // existence -> 404
    await expect(publish(99)).rejects.toMatchObject({ status: 404 })

    query.mockResolvedValueOnce({ rows: [] }) // UPDATE matches nothing (already published)
    query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // exists -> 409
    await expect(publish(1)).rejects.toMatchObject({ status: 409 })
  })

  it('unpublish flips published->draft; 404 missing; 409 already draft', async () => {
    query.mockResolvedValueOnce({ rows: [scheduleRow({ status: 'draft' })] })
    const draft = await unpublish(1)
    expect(draft.status).toBe('draft')

    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [] })
    await expect(unpublish(99)).rejects.toMatchObject({ status: 404 })

    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
    await expect(unpublish(1)).rejects.toMatchObject({ status: 409 })
  })
})

describe('published lock', () => {
  it('addDuty 409 when published', async () => {
    query.mockResolvedValueOnce({ rows: [scheduleRow({ status: 'published' })] })
    await expect(
      addDuty(1, { date: '2026-09-05', doctorId: 5 }, { id: 2, role: 'administrator' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('reassignDuty 409 when published', async () => {
    query.mockResolvedValueOnce({ rows: [dutyRow({ schedule_status: 'published' })] })
    await expect(
      reassignDuty(10, { doctorId: 7 }, { id: 2, role: 'administrator' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('removeDuty 409 when published', async () => {
    query.mockResolvedValueOnce({ rows: [dutyRow({ schedule_status: 'published' })] })
    await expect(removeDuty(10)).rejects.toMatchObject({ status: 409 })
  })

  it('remove (schedule) 409 when published', async () => {
    query.mockResolvedValueOnce({ rows: [{ status: 'published' }] })
    await expect(remove(1)).rejects.toMatchObject({ status: 409 })
  })
})

describe('computeEligibility', () => {
  const day = (date: string, isWeekend = false, isHoliday = false) => ({
    date,
    dayOfWeek: new Date(`${date}T00:00:00Z`).getUTCDay(),
    isWeekend,
    isHoliday,
  })
  const empty = () => ({
    dutiesByDate: new Map<string, Set<number>>(),
    dutyCountByDoctor: new Map<number, number>(),
    saturdayByDoctor: new Map<number, number>(),
    sundayByDoctor: new Map<number, number>(),
  })
  const doctor = (id: number, maxMonthlyDuties = 7): DoctorSpec => ({
    id,
    firstName: `D${id}`,
    lastName: `D${id}`,
    maxMonthlyDuties,
    isActive: true,
  })

  it('eligible: active, available, under cap, not on adjacent duty -> included', () => {
    const result = computeEligibility({
      doctors: [doctor(1)],
      unavailability: new Map(),
      days: [day('2026-09-10')],
      ...empty(),
    })
    expect(result).toEqual([
      { date: '2026-09-10', isWeekend: false, isHoliday: false, eligibleDoctorIds: [1], availableDoctorIds: [1] },
    ])
  })

  it('unavailable: an unavailability range containing the date -> excluded', () => {
    const result = computeEligibility({
      doctors: [doctor(1)],
      unavailability: new Map([[1, [{ start: '2026-09-09', end: '2026-09-12' }]]]),
      days: [day('2026-09-10')],
      ...empty(),
    })
    expect(result[0]?.eligibleDoctorIds).toEqual([])
  })

  it('at cap: dutyCountByDoctor >= maxMonthlyDuties -> excluded', () => {
    const result = computeEligibility({
      doctors: [doctor(1, 7)],
      unavailability: new Map(),
      days: [day('2026-09-10')],
      ...empty(),
      dutyCountByDoctor: new Map([[1, 7]]),
    })
    expect(result[0]?.eligibleDoctorIds).toEqual([])
  })

  it('own-duty exclusion: assigned today reduces count by 1 -> back under cap -> included', () => {
    const result = computeEligibility({
      doctors: [doctor(1, 7)],
      unavailability: new Map(),
      days: [day('2026-09-10')],
      ...empty(),
      dutiesByDate: new Map([['2026-09-10', new Set([1])]]),
      dutyCountByDoctor: new Map([[1, 7]]),
    })
    expect(result[0]?.eligibleDoctorIds).toEqual([1])
  })

  it('back-to-back: doctor on prevDate or nextDate -> excluded', () => {
    // previous day already assigned
    const fromPrev = computeEligibility({
      doctors: [doctor(1)],
      unavailability: new Map(),
      days: [day('2026-09-10')],
      ...empty(),
      dutiesByDate: new Map([['2026-09-09', new Set([1])]]),
    })
    expect(fromPrev[0]?.eligibleDoctorIds).toEqual([])
    // next day already assigned
    const fromNext = computeEligibility({
      doctors: [doctor(1)],
      unavailability: new Map(),
      days: [day('2026-09-10')],
      ...empty(),
      dutiesByDate: new Map([['2026-09-11', new Set([1])]]),
    })
    expect(fromNext[0]?.eligibleDoctorIds).toEqual([])
  })

  it('empty: when no doctor passes -> eligibleDoctorIds is []', () => {
    const result = computeEligibility({
      doctors: [doctor(1, 7), doctor(2, 7)],
      unavailability: new Map(),
      days: [day('2026-09-10')],
      ...empty(),
      dutyCountByDoctor: new Map([
        [1, 7],
        [2, 7],
      ]),
    })
    expect(result[0]?.eligibleDoctorIds).toEqual([])
  })
})
