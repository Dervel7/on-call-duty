import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client.ts', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

const logActivity = vi.fn()
const recordActivity = vi.fn()
vi.mock('../services/activity.service.ts', () => ({
  logActivity: (...a: unknown[]) => logActivity(...a),
  recordActivity: (...a: unknown[]) => recordActivity(...a),
}))

// Per-clinic slot counts and minimums come from the clinics row; pin the
// seeded 2/2/2 slots (tests override the minimums) so the query sequences
// below only carry the cycle (app_meta) lookups.
const getDutyMinimums = vi.fn()
vi.mock('../services/settings.service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/settings.service.ts')>()),
  getDutySlots: async () => ({ openDutySlots: 2, postOpenDutySlots: 2, closedDutySlots: 2 }),
  getDutyMinimums: (...a: unknown[]) => getDutyMinimums(...a),
}))

import { generate, getById, list, publish, remove, unpublish } from '../services/schedule.service.ts'
import { CLINIC_DOCTORS as doctors, SCOPE, SEEDED_MINIMUMS, scheduleRow } from './helpers/schedule-fixtures.ts'

beforeEach(() => {
  query.mockReset()
  logActivity.mockReset()
  recordActivity.mockReset()
  getDutyMinimums.mockReset()
  getDutyMinimums.mockResolvedValue(SEEDED_MINIMUMS)
})

describe('schedule.service', () => {
  it('generate 409 when the month already exists', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    await expect(
      generate(2026, 9, { id: 2, role: 'administrator', clinicId: 1 }, SCOPE, [{ date: '2026-09-01', doctorId: 1 }]),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('list applies optional year/month filters', async () => {
    query.mockResolvedValue({ rows: [scheduleRow()] })
    await list({ year: 2026, month: 9 }, { id: 2, role: 'administrator', clinicId: 1 }, SCOPE)
    expect(query.mock.calls[0]?.[1]).toEqual([1, 2026, 9])
  })

  it.each([
    ['doctor', 1],
    ['manager', null],
  ] as const)('list shows only published schedules to a %s', async (role, clinicId) => {
    query.mockResolvedValue({ rows: [] })
    await list({}, { id: 5, role, clinicId }, SCOPE)
    expect(query.mock.calls[0]?.[1]).toEqual([1, 'published'])
  })

  it('getById refuses a draft to a manager (403), like the list hides it', async () => {
    query.mockResolvedValue({ rows: [scheduleRow({ status: 'draft' })] })
    await expect(getById(1, { id: 5, role: 'manager', clinicId: null })).rejects.toMatchObject({ status: 403 })
  })

  it('getById 404 when missing', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(getById(99, { id: 2, role: 'administrator', clinicId: 1 })).rejects.toMatchObject({ status: 404 })
  })

  it('getById blanks eligibility for a doctor viewing a published schedule', async () => {
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM schedules') && sql.includes('WHERE s.id =')) {
        return { rows: [scheduleRow({ status: 'published' })] }
      }
      if (sql.includes('FROM duties du')) return { rows: [] }
      return { rows: [] }
    })
    const detail = await getById(1, { id: 5, role: 'doctor', clinicId: 1 })
    expect(detail.schedule.status).toBe('published')
    expect(detail.days).toHaveLength(30)
    expect(detail.days.every((d) => d.eligibleDoctorIds.length === 0)).toBe(true)
    expect(detail.days.every((d) => d.availableDoctorIds.length === 0)).toBe(true)
    // Non-admins must not fund the admin eligibility queries.
    expect(query.mock.calls.some((c) => String(c[0]).includes('FROM doctors d JOIN users'))).toBe(false)
  })

  it('remove deletes the schedule (404 when missing)', async () => {
    query.mockResolvedValueOnce({ rows: [scheduleRow()] })
    query.mockResolvedValueOnce({ rows: [{ status: 'draft' }] })
    query.mockResolvedValueOnce({ rows: [] })
    await remove(1, { id: 2, role: 'administrator', clinicId: 1 })
    expect((query.mock.calls[2]?.[0] as string).includes('DELETE FROM schedules')).toBe(true)
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'schedule.deleted', entityId: 1 }),
    )

    query.mockReset()
    logActivity.mockReset()
    query.mockResolvedValue({ rows: [] })
    await expect(remove(99, { id: 2, role: 'administrator', clinicId: 1 })).rejects.toMatchObject({
      status: 404,
    })
  })
})

describe('generate plan path', () => {
  // Closed days need one doctor (stored closed minimum 1); open days fall
  // back to their full slot count.
  function mockContext() {
    getDutyMinimums.mockResolvedValue({ ...SEEDED_MINIMUMS, closedDutyMinimum: 1 })
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM schedules') && sql.includes('year =')) return { rows: [] }
      if (sql.includes('FROM doctors d JOIN users')) return { rows: doctors }
      if (sql.includes('FROM unavailability')) return { rows: [] }
      if (sql.includes('FROM duties WHERE duty_date =')) return { rows: [] }
      if (sql.includes('INSERT INTO schedules')) return { rows: [{ id: 7 }] }
      if (sql.includes('INSERT INTO duties')) return { rows: [] }
      if (sql.includes('FROM schedules') && sql.includes('WHERE s.id =')) {
        return { rows: [scheduleRow({ id: 7 })] }
      }
      if (sql.includes('FROM duties du')) return { rows: [] }
      return { rows: [] }
    })
  }

  it('persists a valid 1-doctor-per-day plan when the closed minimum is 1', async () => {
    mockContext()
    const assignments = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      doctorId: (i % 12) + 1,
      reason: 'manual override',
    }))
    const detail = await generate(2026, 9, { id: 2, role: 'administrator', clinicId: 1 }, SCOPE, assignments)
    expect(detail.schedule.id).toBe(7)
    const inserts = query.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO duties'))
    expect(inserts.length).toBe(30)
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'schedule.generated', entityId: 7 }),
    )
  })

  it('422 when any day has no doctor', async () => {
    mockContext()
    const assignments = Array.from({ length: 29 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      doctorId: (i % 12) + 1,
    }))
    await expect(
      generate(2026, 9, { id: 2, role: 'administrator', clinicId: 1 }, SCOPE, assignments),
    ).rejects.toMatchObject({ status: 422 })
    expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO schedules'))).toBe(false)
  })

  it('422 when an open on-call day has fewer doctors than its minimum', async () => {
    // Anchor 2026-09-01: 09-01 is open and keeps its minimum of 2; the day
    // after uses a post-open minimum of 1.
    getDutyMinimums.mockResolvedValue({ openDutyMinimum: 2, postOpenDutyMinimum: 1, closedDutyMinimum: 1 })
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM app_meta'))
        return {
          rows: [
            { key: 'open_duty_anchor_date', value: '2026-09-01' },
            { key: 'open_duty_interval_days', value: '30' },
          ],
        }
      if (sql.includes('FROM schedules') && sql.includes('year =')) return { rows: [] }
      if (sql.includes('FROM doctors d JOIN users')) return { rows: doctors }
      if (sql.includes('FROM unavailability')) return { rows: [] }
      if (sql.includes('FROM duties WHERE duty_date =')) return { rows: [] }
      return { rows: [] }
    })
    const assignments = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      doctorId: (i % 12) + 1,
    }))
    await expect(
      generate(2026, 9, { id: 2, role: 'administrator', clinicId: 1 }, SCOPE, assignments),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringMatching(/^1 day\(s\) are below their minimum on-call doctors: 2026-09-01;/),
    })
    expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO schedules'))).toBe(false)
  })

  it('accepts over-cap holiday duties on critical days (strict rules outrank fairness)', async () => {
    // Anchor 2026-09-05, interval 7: every Saturday is open and every Sunday
    // the day after one — all critical. Doctor 3 takes three Sunday duties —
    // over the holiday cap of 2 — and the plan still persists. The open
    // Saturdays use distinct doctors: one open on-call duty per doctor is a
    // hard rule now.
    const manyDoctors = Array.from({ length: 16 }, (_, i) => ({
      id: i + 1,
      max_monthly_duties: 7,
      first_name: `D${i + 1}`,
      last_name: `D${i + 1}`,
      is_active: true,
    }))
    getDutyMinimums.mockResolvedValue({ ...SEEDED_MINIMUMS, closedDutyMinimum: 1 })
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM app_meta'))
        return {
          rows: [
            { key: 'open_duty_anchor_date', value: '2026-09-05' },
            { key: 'open_duty_interval_days', value: '7' },
          ],
        }
      if (sql.includes('FROM schedules') && sql.includes('year =')) return { rows: [] }
      if (sql.includes('FROM doctors d JOIN users')) return { rows: manyDoctors }
      if (sql.includes('FROM unavailability')) return { rows: [] }
      if (sql.includes('FROM duties WHERE duty_date =')) return { rows: [] }
      if (sql.includes('INSERT INTO schedules')) return { rows: [{ id: 7 }] }
      if (sql.includes('INSERT INTO duties')) return { rows: [] }
      if (sql.includes('FROM schedules') && sql.includes('WHERE s.id =')) {
        return { rows: [scheduleRow({ id: 7 })] }
      }
      return { rows: [] }
    })
    const critical: Array<[number, number, number]> = [
      // [date, doctorA, doctorB] for 05,06,12,13,19,20,26,27
      [5, 1, 2],
      [6, 3, 4],
      [12, 5, 6],
      [13, 3, 7],
      [19, 8, 9],
      [20, 7, 3],
      [26, 11, 12],
      [27, 10, 5],
    ]
    // Regular weekdays rotate over doctors 13-16, avoiding the doctors held
    // by each neighbouring critical pair (verified: no back-to-back, all
    // monthly counts <= 7).
    const regular: Array<[number, number]> = [
      [1, 13], [2, 14], [3, 15], [4, 13],
      [7, 13], [8, 16], [9, 13], [10, 14],
      [11, 15], [14, 16], [15, 15], [16, 16],
      [17, 13], [18, 14], [21, 13], [22, 14],
      [23, 15], [24, 16], [25, 15], [28, 14],
      [29, 13], [30, 14],
    ]
    const assignments = [
      ...critical.flatMap(([d, a, b]) => [
        { date: `2026-09-${String(d).padStart(2, '0')}`, doctorId: a },
        { date: `2026-09-${String(d).padStart(2, '0')}`, doctorId: b },
      ]),
      ...regular.map(([d, doc]) => ({ date: `2026-09-${String(d).padStart(2, '0')}`, doctorId: doc })),
    ]
    const detail = await generate(2026, 9, { id: 2, role: 'administrator', clinicId: 1 }, SCOPE, assignments)
    expect(detail.schedule.id).toBe(7)
    expect(query.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO duties')).length).toBe(38)
  })

  it('accepts a third weekend duty when its day has a single doctor (day-fill guarantee)', async () => {
    // Doctor 6 takes Sundays 06 and 20, then Sunday 2026-09-27 as the day's
    // only doctor — a third weekend duty, over the holiday cap of 2.
    // Removing the duty would drop the day below its minimum of 1: the
    // minimum-coverage rule outranks fairness and the plan persists.
    mockContext()
    const assignments = Array.from({ length: 30 }, (_, i) => {
      const day = i + 1
      const doctorId = day === 20 || day === 27 ? 6 : (i % 12) + 1
      return { date: `2026-09-${String(day).padStart(2, '0')}`, doctorId }
    })
    const detail = await generate(2026, 9, { id: 2, role: 'administrator', clinicId: 1 }, SCOPE, assignments)
    expect(detail.schedule.id).toBe(7)
    expect(query.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO duties')).length).toBe(30)
  })

  it('409 when a third weekend duty sits on a day with two doctors', async () => {
    // Doctor 6 takes Sundays 06 and 20, then a third on 2026-09-27 next to
    // doctor 3: over the holiday cap of 2, and the day keeps a doctor
    // without this duty, so the fairness cap must refuse the plan.
    mockContext()
    const base = Array.from({ length: 30 }, (_, i) => {
      const day = i + 1
      const doctorId = day === 20 || day === 27 ? 6 : (i % 12) + 1
      return { date: `2026-09-${String(day).padStart(2, '0')}`, doctorId }
    })
    const assignments = [...base, { date: '2026-09-27', doctorId: 3 }]
    await expect(
      generate(2026, 9, { id: 2, role: 'administrator', clinicId: 1 }, SCOPE, assignments),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('holiday cap'),
    })
    expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO schedules'))).toBe(false)
  })

  it('409 when a doctor is assigned a second open on-call day (one per doctor)', async () => {
    // Same month as the test above, but doctor 1 holds BOTH open Saturdays
    // 05 and 12 — the strict open on-call cap must refuse the plan.
    const manyDoctors = Array.from({ length: 16 }, (_, i) => ({
      id: i + 1,
      max_monthly_duties: 7,
      first_name: `D${i + 1}`,
      last_name: `D${i + 1}`,
      is_active: true,
    }))
    getDutyMinimums.mockResolvedValue({ ...SEEDED_MINIMUMS, closedDutyMinimum: 1 })
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM app_meta'))
        return {
          rows: [
            { key: 'open_duty_anchor_date', value: '2026-09-05' },
            { key: 'open_duty_interval_days', value: '7' },
          ],
        }
      if (sql.includes('FROM schedules') && sql.includes('year =')) return { rows: [] }
      if (sql.includes('FROM doctors d JOIN users')) return { rows: manyDoctors }
      if (sql.includes('FROM unavailability')) return { rows: [] }
      if (sql.includes('FROM duties WHERE duty_date =')) return { rows: [] }
      return { rows: [] }
    })
    const critical: Array<[number, number, number]> = [
      [5, 1, 2],
      [6, 3, 4],
      [12, 1, 6],
      [13, 3, 7],
      [19, 8, 9],
      [20, 7, 10],
      [26, 11, 12],
      [27, 10, 5],
    ]
    const regular: Array<[number, number]> = [
      [1, 13], [2, 14], [3, 15], [4, 13],
      [7, 13], [8, 16], [9, 13], [10, 14],
      [11, 15], [14, 16], [15, 15], [16, 16],
      [17, 13], [18, 14], [21, 13], [22, 14],
      [23, 15], [24, 16], [25, 15], [28, 14],
      [29, 13], [30, 14],
    ]
    const assignments = [
      ...critical.flatMap(([d, a, b]) => [
        { date: `2026-09-${String(d).padStart(2, '0')}`, doctorId: a },
        { date: `2026-09-${String(d).padStart(2, '0')}`, doctorId: b },
      ]),
      ...regular.map(([d, doc]) => ({ date: `2026-09-${String(d).padStart(2, '0')}`, doctorId: doc })),
    ]
    await expect(
      generate(2026, 9, { id: 2, role: 'administrator', clinicId: 1 }, SCOPE, assignments),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('open on-call') })
    expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO schedules'))).toBe(false)
  })


  it('409 when a doctor is on vacation that date (availability is hard)', async () => {
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM schedules') && sql.includes('year =')) return { rows: [] }
      if (sql.includes('FROM doctors d JOIN users')) return { rows: doctors }
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
      generate(2026, 9, { id: 2, role: 'administrator', clinicId: 1 }, SCOPE, assignments),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('409 when the same doctor is assigned twice on a date', async () => {
    mockContext()
    const assignments = [
      { date: '2026-09-01', doctorId: 1 },
      { date: '2026-09-01', doctorId: 1 },
    ]
    await expect(
      generate(2026, 9, { id: 2, role: 'administrator', clinicId: 1 }, SCOPE, assignments),
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
      generate(2026, 9, { id: 2, role: 'administrator', clinicId: 1 }, SCOPE, assignments),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('409 when a plan exceeds a doctor monthly cap', async () => {
    mockContext()
    // Doctor 1 capped at 7; alternate days give 15 duties.
    const assignments = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      doctorId: i % 2 === 0 ? 1 : 2,
    }))
    await expect(
      generate(2026, 9, { id: 2, role: 'administrator', clinicId: 1 }, SCOPE, assignments),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('monthly cap') })
  })

  it('409 when a plan puts a doctor on back-to-back days', async () => {
    mockContext()
    const assignments = [
      ...Array.from({ length: 28 }, (_, i) => ({
        date: `2026-09-${String(i + 3).padStart(2, '0')}`,
        doctorId: (i % 10) + 3,
      })),
      { date: '2026-09-01', doctorId: 1 },
      { date: '2026-09-02', doctorId: 1 },
    ]
    await expect(
      generate(2026, 9, { id: 2, role: 'administrator', clinicId: 1 }, SCOPE, assignments),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('back-to-back') })
  })

  it.each([
    ['prior month last-day', '2026-08-31', '2026-09-01'],
    ['next month first-day', '2026-10-01', '2026-09-30'],
  ])('409 when a plan collides with the %s duty', async (_label, adjacentDate, planDate) => {
    getDutyMinimums.mockResolvedValue({ ...SEEDED_MINIMUMS, closedDutyMinimum: 1 })
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM schedules') && sql.includes('year =')) return { rows: [] }
      if (sql.includes('FROM doctors d JOIN users')) return { rows: doctors }
      if (sql.includes('du.duty_date IN')) return { rows: [{ duty_date: adjacentDate, doctor_id: 1 }] }
      return { rows: [] }
    })

    const assignments = Array.from({ length: 30 }, (_, i) => {
      const date = `2026-09-${String(i + 1).padStart(2, '0')}`
      return { date, doctorId: date === planDate ? 1 : (i % 10) + 2 }
    })
    await expect(
      generate(2026, 9, { id: 2, role: 'administrator', clinicId: 1 }, SCOPE, assignments),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('back-to-back') })
  })

  it('judges the holiday cap on final counts: reversing the plan gives the same outcome', async () => {
    // Doctor 6 holds Sundays 06, 20 and 27 with doctor 3 next to them on 27.
    mockContext()
    const base = Array.from({ length: 30 }, (_, i) => {
      const day = i + 1
      const doctorId = day === 20 || day === 27 ? 6 : (i % 12) + 1
      return { date: `2026-09-${String(day).padStart(2, '0')}`, doctorId }
    })
    const plan = [...base, { date: '2026-09-27', doctorId: 3 }]
    for (const ordered of [plan, [...plan].reverse()]) {
      await expect(
        generate(2026, 9, { id: 2, role: 'administrator', clinicId: 1 }, SCOPE, ordered),
      ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('holiday cap') })
    }
  })
})

describe('publish / unpublish', () => {
  it('publish 409 when a day is left uncovered', async () => {
    query
      .mockResolvedValueOnce({ rows: [scheduleRow()] }) // select (draft)
      .mockResolvedValueOnce({ rows: [] }) // app_meta: open duty -> seeded defaults
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // UPDATE matches
      .mockResolvedValueOnce({
        rows: Array.from({ length: 29 }, (_, i) => ({ duty_date: `2026-09-${String(i + 1).padStart(2, '0')}`, n: 1 })),
      }) // coverage per date: 29 of 30 days
    await expect(publish(1, { id: 2, role: 'administrator', clinicId: 1 })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('incomplete'),
    })
    expect(recordActivity).not.toHaveBeenCalled()
  })
  it('publish 409 when an open on-call day is below its minimum', async () => {
    // Seeded defaults (anchor 2026-10-02, interval 8) make 10-02, 10-10,
    // 10-18 and 10-26 open; they keep the seeded open minimum of 2.
    // Post-open and closed days (minimum 1) are fine with one doctor.
    getDutyMinimums.mockResolvedValue({ openDutyMinimum: 2, postOpenDutyMinimum: 1, closedDutyMinimum: 1 })
    query
      .mockResolvedValueOnce({ rows: [scheduleRow({ year: 2026, month: 10 })] }) // select (draft)
      .mockResolvedValueOnce({ rows: [] }) // app_meta: open duty -> seeded defaults
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // UPDATE matches
      .mockResolvedValueOnce({
        rows: Array.from({ length: 31 }, (_, i) => ({ duty_date: `2026-10-${String(i + 1).padStart(2, '0')}`, n: 1 })),
      }) // every day covered once
    await expect(publish(1, { id: 2, role: 'administrator', clinicId: 1 })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('4 day(s) are below their minimum on-call doctors before publishing: 2026-10-02, 2026-10-10, 2026-10-18, 2026-10-26'),
    })
    expect(recordActivity).not.toHaveBeenCalled()
  })
  it('publish flips draft->published when every day meets its minimum (below the slot count); 404 missing; 409 already published', async () => {
    getDutyMinimums.mockResolvedValue({ ...SEEDED_MINIMUMS, closedDutyMinimum: 1 })
    query
      .mockResolvedValueOnce({ rows: [scheduleRow()] }) // select (draft)
      .mockResolvedValueOnce({ rows: [] }) // app_meta: open duty -> seeded defaults
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // UPDATE matches
      .mockResolvedValueOnce({
        rows: Array.from({ length: 30 }, (_, i) => ({ duty_date: `2026-09-${String(i + 1).padStart(2, '0')}`, n: 2 })),
      }) // coverage complete
      .mockResolvedValueOnce({ rows: [scheduleRow({ status: 'published' })] }) // re-select
    const published = await publish(1, { id: 2, role: 'administrator', clinicId: 1 })
    expect(published.status).toBe('published')
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'schedule.published',
        entityId: 1,
        detail: expect.objectContaining({ dutyCount: 60 }),
      }),
    )

    query.mockReset()
    logActivity.mockReset()
    query.mockResolvedValueOnce({ rows: [] }) // select finds nothing -> 404
    await expect(publish(99, { id: 2, role: 'administrator', clinicId: 1 })).rejects.toMatchObject({
      status: 404,
    })

    query.mockReset()
    query.mockResolvedValueOnce({ rows: [scheduleRow({ status: 'published' })] }) // select finds it
    query.mockResolvedValueOnce({ rows: [] }) // app_meta: open duty -> seeded defaults
    query.mockResolvedValueOnce({ rows: [] }) // UPDATE matches nothing (already published) -> 409
    await expect(publish(1, { id: 2, role: 'administrator', clinicId: 1 })).rejects.toMatchObject({
      status: 409,
    })
  })

  it('unpublish flips published->draft; 404 missing; 409 already draft', async () => {
    query
      .mockResolvedValueOnce({ rows: [scheduleRow({ status: 'published' })] }) // select
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // UPDATE matches
      .mockResolvedValueOnce({ rows: [scheduleRow({ status: 'draft' })] }) // re-select
    const draft = await unpublish(1, { id: 2, role: 'administrator', clinicId: 1 })
    expect(draft.status).toBe('draft')
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'schedule.reverted', entityId: 1 }),
    )

    query.mockReset()
    logActivity.mockReset()
    query.mockResolvedValueOnce({ rows: [] }) // select finds nothing -> 404
    await expect(unpublish(99, { id: 2, role: 'administrator', clinicId: 1 })).rejects.toMatchObject({
      status: 404,
    })

    query.mockReset()
    query.mockResolvedValueOnce({ rows: [scheduleRow()] }) // select finds it (draft)
    query.mockResolvedValueOnce({ rows: [] }) // UPDATE matches nothing (already draft) -> 409
    await expect(unpublish(1, { id: 2, role: 'administrator', clinicId: 1 })).rejects.toMatchObject({
      status: 409,
    })
  })

  it('remove (schedule) 409 when published', async () => {
    query.mockResolvedValueOnce({ rows: [scheduleRow({ status: 'published' })] })
    await expect(remove(1, { id: 2, role: 'administrator', clinicId: 1 })).rejects.toMatchObject({
      status: 409,
    })
  })
})
