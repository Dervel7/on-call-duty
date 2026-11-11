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
const SEEDED_MINIMUMS = { openDutyMinimum: 2, postOpenDutyMinimum: 2, closedDutyMinimum: 2 }
const getDutyMinimums = vi.fn()
vi.mock('../services/settings.service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/settings.service.ts')>()),
  getDutySlots: async () => ({ openDutySlots: 2, postOpenDutySlots: 2, closedDutySlots: 2 }),
  getDutyMinimums: (...a: unknown[]) => getDutyMinimums(...a),
}))

import {
  addDuty,
  computeEligibility,
  generate,
  generateAlternative,
  generateOptions,
  getById,
  list,
  publish,
  reassignDuty,
  remove,
  removeDuty,
  unpublish,
} from '../services/schedule.service.ts'
import type { DoctorSpec } from '../scheduling/types.ts'

function scheduleRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    year: 2026,
    month: 9,
    status: 'draft',
    clinic_id: 1,
    clinic_name: 'Radiology',
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
    schedule_year: 2026,
    schedule_month: 9,
    schedule_clinic_id: 1,
    schedule_status: 'draft',
    duty_date: '2026-09-05',
    doctor_id: 5,
    first_name: 'Jane',
    last_name: 'Roe',
    is_weekend: false,
    reason: 'score 1 (workload +1, weekend +0, friday +0)',
    created_at: new Date('2026-08-01'),
    ...overrides,
  }
}
const SCOPE = { clinicId: 1 } as const

beforeEach(() => {
  query.mockReset()
  logActivity.mockReset()
  recordActivity.mockReset()
  getDutyMinimums.mockReset()
  getDutyMinimums.mockResolvedValue(SEEDED_MINIMUMS)
})

const ADMIN = { id: 2, role: 'administrator' as const, clinicId: 1 }

interface EditDb {
  schedule?: Record<string, unknown>
  duty?: Record<string, unknown>
  /** Active doctors of the clinic; defaults to doctor 5. */
  doctors?: number[]
  /** The doctor exists in the clinic although inactive. */
  knownDoctor?: boolean
  held?: Array<{ duty_date: string; doctor_id: number }>
  unavailability?: Array<{ doctor_id: number; start_date: string; end_date: string }>
  marked?: string[]
  adjacent?: Array<{ duty_date: string; doctor_id: number }>
  appMeta?: Array<{ key: string; value: string }>
  count?: number
  updated?: boolean
  deleted?: boolean
}

/** SQL-keyed database for the manual duty edit paths (add, reassign, remove). */
function mockEditDb(o: EditDb = {}) {
  query.mockImplementation(async (text: unknown) => {
    const sql = String(text)
    if (sql.includes('FOR UPDATE')) return { rows: [{ status: 'draft' }] }
    if (sql.includes('WHERE du.id = $1')) return { rows: [dutyRow(o.duty)] }
    if (sql.includes('FROM schedules s JOIN clinics')) return { rows: [scheduleRow(o.schedule)] }
    if (sql.includes('FROM app_meta')) return { rows: o.appMeta ?? [] }
    if (sql.includes('FROM doctors d JOIN users')) {
      return {
        rows: (o.doctors ?? [5]).map((id) => ({ id, max_monthly_duties: 7, first_name: `D${id}`, last_name: `D${id}` })),
      }
    }
    if (sql.includes('FROM doctors WHERE id')) return { rows: o.knownDoctor ? [{ '?column?': 1 }] : [] }
    if (sql.includes('FROM unavailability')) return { rows: o.unavailability ?? [] }
    if (sql.includes('FROM holidays')) return { rows: (o.marked ?? []).map((d) => ({ holiday_date: d })) }
    if (sql.includes('du.duty_date IN')) return { rows: o.adjacent ?? [] }
    if (sql.includes('doctor_id FROM duties')) return { rows: o.held ?? [] }
    if (sql.includes('INSERT INTO duties')) return { rows: [{ id: 11 }] }
    if (sql.includes('UPDATE duties')) return { rows: o.updated === false ? [] : [{ id: 10 }] }
    if (sql.includes('DELETE FROM duties')) return { rows: o.deleted === false ? [] : [{ id: 10 }] }
    if (sql.includes('SELECT COUNT(*)::int')) return { rows: [{ n: o.count ?? 0 }] }
    return { rows: [] }
  })
}

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
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('year =')
    expect(sql).toContain('month =')
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

  it('addDuty rejects an out-of-month date with 400', async () => {
    query.mockResolvedValueOnce({ rows: [scheduleRow()] })
    await expect(
      addDuty(1, { date: '2026-10-05', doctorId: 5 }, { id: 2, role: 'administrator', clinicId: 1 }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('addDuty rejects a date with every slot filled (409)', async () => {
    mockEditDb({
      doctors: [5, 6, 7],
      held: [
        { duty_date: '2026-09-05', doctor_id: 6 },
        { duty_date: '2026-09-05', doctor_id: 7 },
      ],
    })
    await expect(addDuty(1, { date: '2026-09-05', doctorId: 5 }, ADMIN)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('slots'),
    })
  })

  it('addDuty inserts the duty and records the audit row in-transaction', async () => {
    mockEditDb()
    await addDuty(1, { date: '2026-09-05', doctorId: 5 }, ADMIN)
    const ranges = query.mock.calls.find((c) => String(c[0]).includes('FROM unavailability'))
    expect(String(ranges?.[0])).toContain('is_disabled = FALSE')
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'duty.assigned', entityId: 11 }),
    )
  })

  it('addDuty 404 for an unknown doctor and 409 for an inactive one', async () => {
    mockEditDb({ doctors: [] })
    await expect(addDuty(1, { date: '2026-09-05', doctorId: 5 }, ADMIN)).rejects.toMatchObject({ status: 404 })
    mockEditDb({ doctors: [], knownDoctor: true })
    await expect(addDuty(1, { date: '2026-09-05', doctorId: 5 }, ADMIN)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('inactive'),
    })
    expect(recordActivity).not.toHaveBeenCalled()
  })

  const weekdays = ['01', '03', '08', '10', '15', '17', '22'].map((d) => ({
    duty_date: `2026-09-${d}`,
    doctor_id: 5,
  }))
  it.each<[string, EditDb, string, RegExp]>([
    ['the same doctor twice on a date', { held: [{ duty_date: '2026-09-09', doctor_id: 5 }] }, '2026-09-09', /already assigned/],
    ['the monthly cap', { held: weekdays }, '2026-09-24', /monthly cap/],
    [
      'unavailability',
      { unavailability: [{ doctor_id: 5, start_date: '2026-09-09', end_date: '2026-09-11' }] },
      '2026-09-10',
      /unavailable/,
    ],
    ['back-to-back inside the month', { held: [{ duty_date: '2026-09-09', doctor_id: 5 }] }, '2026-09-10', /back-to-back/],
    ['back-to-back with the prior month', { adjacent: [{ duty_date: '2026-08-31', doctor_id: 5 }] }, '2026-09-01', /back-to-back/],
    ['back-to-back with the next month', { adjacent: [{ duty_date: '2026-10-01', doctor_id: 5 }] }, '2026-09-30', /back-to-back/],
  ])('addDuty 409 on %s', async (_rule, edit, date, message) => {
    mockEditDb(edit)
    await expect(addDuty(1, { date, doctorId: 5 }, ADMIN)).rejects.toMatchObject({ status: 409, message })
    expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO duties'))).toBe(false)
  })

  const october = { schedule: { year: 2026, month: 10 } }
  it('addDuty 409 on the holiday cap counting a marked weekday holiday', async () => {
    // Sunday 10-25 and the marked Wednesday 10-28 are two holiday duties
    // already, so a third on Saturday 10-31 is refused.
    mockEditDb({
      ...october,
      marked: ['2026-10-28'],
      held: [
        { duty_date: '2026-10-25', doctor_id: 5 },
        { duty_date: '2026-10-28', doctor_id: 5 },
      ],
    })
    await expect(addDuty(1, { date: '2026-10-31', doctorId: 5 }, ADMIN)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('holiday cap'),
    })
  })

  it('addDuty on a critical Saturday skips the holiday cap', async () => {
    // Seeded defaults: 2026-10-02 is an open day, so Saturday 10-03 is
    // critical although the doctor already holds two holiday duties.
    mockEditDb({
      ...october,
      held: [
        { duty_date: '2026-10-17', doctor_id: 5 },
        { duty_date: '2026-10-24', doctor_id: 5 },
      ],
    })
    await addDuty(1, { date: '2026-10-03', doctorId: 5 }, ADMIN)
    expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO duties'))).toBe(true)
  })

  it('addDuty validates after the schedule row is locked', async () => {
    mockEditDb()
    await addDuty(1, { date: '2026-09-05', doctorId: 5 }, ADMIN)
    const at = (needle: string): number => query.mock.calls.findIndex((c) => String(c[0]).includes(needle))
    expect(at('FOR UPDATE')).toBeGreaterThan(-1)
    expect(at('FOR UPDATE')).toBeLessThan(at('FROM doctors d JOIN users'))
    expect(at('FOR UPDATE')).toBeLessThan(at('SELECT duty_date::text AS duty_date, doctor_id FROM duties'))
  })

  it('reassignDuty runs the rule checks and updates the row', async () => {
    mockEditDb({ duty: { doctor_id: 7 }, doctors: [7] })
    await reassignDuty(10, { doctorId: 7 }, ADMIN)
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'duty.reassigned', entityId: 10 }),
    )
  })

  it('reassignDuty 409 when the doctor already holds an open on-call duty', async () => {
    // Anchor 2026-09-05, interval 7: 09-05 and 09-12 are both open days.
    mockEditDb({
      duty: { duty_date: '2026-09-12' },
      held: [{ duty_date: '2026-09-05', doctor_id: 5 }],
      appMeta: [
        { key: 'open_duty_anchor_date', value: '2026-09-05' },
        { key: 'open_duty_interval_days', value: '7' },
      ],
    })
    await expect(reassignDuty(10, { doctorId: 5 }, ADMIN)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('open on-call'),
    })
    expect(query.mock.calls.some((c) => String(c[0]).includes('UPDATE duties'))).toBe(false)
  })

  it('reassignDuty 404 without an audit row when the duty vanished before the update', async () => {
    mockEditDb({ updated: false })
    await expect(reassignDuty(10, { doctorId: 5 }, ADMIN)).rejects.toMatchObject({ status: 404 })
    expect(recordActivity).not.toHaveBeenCalled()
  })

  it('reassignDuty 404 when the duty is missing', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(reassignDuty(99, { doctorId: 7 }, ADMIN)).rejects.toMatchObject({ status: 404 })
  })

  it('removeDuty deletes the duty and records the audit row', async () => {
    mockEditDb()
    await removeDuty(10, ADMIN)
    expect(query.mock.calls.some((c) => String(c[0]).includes('DELETE FROM duties'))).toBe(true)
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'duty.removed', entityId: 10 }),
    )
  })

  it('removeDuty 404 when the duty is missing', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(removeDuty(99, ADMIN)).rejects.toMatchObject({ status: 404 })
  })

  it('removeDuty 404 without an audit row when the duty vanished before the delete', async () => {
    mockEditDb({ deleted: false })
    await expect(removeDuty(10, ADMIN)).rejects.toMatchObject({ status: 404 })
    expect(recordActivity).not.toHaveBeenCalled()
  })

  it('removeDuty 409 when an open on-call day would drop below its minimum', async () => {
    // 2026-10-02 is the seeded anchor: removing one of 2 doctors leaves 1 < 2.
    mockEditDb({ ...october, duty: { duty_date: '2026-10-02' }, count: 2 })
    await expect(removeDuty(10, ADMIN)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('reassign'),
    })
    expect(query.mock.calls.some((c) => String(c[0]).includes('DELETE FROM duties'))).toBe(false)
  })

  it('removeDuty allows an open on-call day to keep a count at or above its minimum', async () => {
    getDutyMinimums.mockResolvedValue({ ...SEEDED_MINIMUMS, openDutyMinimum: 1 })
    mockEditDb({ ...october, duty: { duty_date: '2026-10-02' }, count: 2 })
    await removeDuty(10, ADMIN)
    expect(query.mock.calls.some((c) => String(c[0]).includes('DELETE FROM duties'))).toBe(true)
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
    const hol = query.mock.calls.find((c) => String(c[0]).includes('FROM holidays'))
    expect(String(hol?.[0])).toContain('clinic_id = $1')
    expect(hol?.[1]).toEqual([1, '2026-09-01', '2026-09-30'])
    const unavail = query.mock.calls.find((c) => String(c[0]).includes('FROM unavailability'))
    expect(String(unavail?.[0])).toContain('is_disabled = FALSE')
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

  function mockClinicData() {
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM doctors d JOIN users')) return { rows: doctors }
      return { rows: [] }
    })
  }

  it('returns only option A, persisting nothing', async () => {
    mockClinicData()
    const res = await generateOptions(2026, 9, SCOPE)
    expect(res.options).toHaveLength(1)
    expect(res.options[0]).toMatchObject({ index: 1, changedDates: [] })
    expect(res.options[0]?.days).toHaveLength(30)
    expect(res.maxOptions).toBe(3)
    expect(res.moreAvailable).toBe(true)
    expect(query.mock.calls.some((c) => String(c[0]).startsWith('INSERT'))).toBe(false)
    expect(recordActivity).not.toHaveBeenCalled()
  })

  it('solves B once, then returns the cached B and builds C after it', async () => {
    mockClinicData()
    const a = await generateOptions(2026, 9, SCOPE)
    const b = await generateAlternative(2026, 9, 2, SCOPE)
    expect(b.option).toMatchObject({ index: 2 })
    expect(b.option?.changedDates.length).toBeGreaterThan(0)
    expect(b.moreAvailable).toBe(true)
    const again = await generateAlternative(2026, 9, 2, SCOPE)
    expect(again.option).toBe(b.option)
    const c = await generateAlternative(2026, 9, 3, SCOPE)
    expect(c.option).toMatchObject({ index: 3 })
    expect(c.moreAvailable).toBe(false)
    const keys = [a.options[0], b.option, c.option].map((o) =>
      o!.assignments.map((x) => `${x.date}/${x.doctorId}`).sort().join(','),
    )
    expect(new Set(keys).size).toBe(3)
  })

  it('400 when option 3 is asked before option 2', async () => {
    mockClinicData()
    await generateOptions(2026, 9, SCOPE)
    await expect(generateAlternative(2026, 9, 3, SCOPE)).rejects.toMatchObject({ status: 400 })
  })

  it('404 when no options were generated for the month', async () => {
    mockClinicData()
    await expect(generateAlternative(2031, 3, 2, SCOPE)).rejects.toMatchObject({
      status: 404,
      message: 'Options expired, generate them again',
    })
  })

  it('404 after the cache entry expires', async () => {
    mockClinicData()
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      await generateOptions(2026, 9, SCOPE)
      vi.setSystemTime(Date.now() + 16 * 60_000)
      await expect(generateAlternative(2026, 9, 2, SCOPE)).rejects.toMatchObject({ status: 404 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('alternative 409 when the month already exists, before the cache is read', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    await expect(generateAlternative(2026, 9, 2, SCOPE)).rejects.toMatchObject({ status: 409 })
  })

  it('429 while another solve holds the slot, and the first solve still finishes', async () => {
    mockClinicData()
    const first = generateOptions(2026, 9, SCOPE)
    await expect(generateOptions(2026, 9, SCOPE)).rejects.toMatchObject({
      status: 429,
      message: 'Solver busy, try again shortly',
    })
    expect((await first).options).toHaveLength(1)
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

  it('addDuty 409 when published', async () => {
    query.mockResolvedValueOnce({ rows: [scheduleRow({ status: 'published' })] })
    await expect(
      addDuty(1, { date: '2026-09-05', doctorId: 5 }, { id: 2, role: 'administrator', clinicId: 1 }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('reassignDuty 409 when published', async () => {
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM duties du') && sql.includes('WHERE du.id = $1')) {
        return { rows: [dutyRow({ schedule_status: 'published' })] }
      }
      if (sql.includes('FROM schedules s JOIN clinics')) {
        return { rows: [scheduleRow({ status: 'published' })] }
      }
      return { rows: [] }
    })
    await expect(
      reassignDuty(10, { doctorId: 7 }, { id: 2, role: 'administrator', clinicId: 1 }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('removeDuty 409 when published', async () => {
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM duties du') && sql.includes('WHERE du.id = $1')) {
        return { rows: [dutyRow({ schedule_status: 'published' })] }
      }
      if (sql.includes('FROM schedules s JOIN clinics')) {
        return { rows: [scheduleRow({ status: 'published' })] }
      }
      return { rows: [] }
    })
    await expect(removeDuty(10, { id: 2, role: 'administrator', clinicId: 1 })).rejects.toMatchObject({
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

describe('computeEligibility', () => {
  const day = (date: string, isWeekend = false, isHoliday = isWeekend) => ({
    date,
    dayOfWeek: new Date(`${date}T00:00:00Z`).getUTCDay(),
    isWeekend,
    isHoliday,
  })
  const empty = () => ({
    openDuty: { anchorDate: '2026-10-02', intervalDays: 8 },
    slots: { openDutySlots: 2, postOpenDutySlots: 2, closedDutySlots: 2 },
    minimums: { openDutyMinimum: 2, postOpenDutyMinimum: 2, closedDutyMinimum: 2 },
    dutiesByDate: new Map<string, Set<number>>(),
    dutyCountByDoctor: new Map<number, number>(),
    regularHolidayByDoctor: new Map<number, number>(),
    criticalHolidayByDoctor: new Map<number, number>(),
    openByDoctor: new Map<number, number>(),
  })

  const doctor = (id: number, maxMonthlyDuties = 7): DoctorSpec => ({
    id,
    firstName: `D${id}`,
    lastName: `D${id}`,
    maxMonthlyDuties,
  })

  it('eligible: active, available, under cap, not on adjacent duty -> included', () => {
    const result = computeEligibility({
      doctors: [doctor(1)],
      unavailability: new Map(),
      days: [day('2026-09-10')],
      ...empty(),
    })
    expect(result).toEqual([
      {
        date: '2026-09-10',
        isWeekend: false,
        dutyType: 'closed',
        slotsRequired: 2,
        slotsMinimum: 2,
        eligibleDoctorIds: [1],
        availableDoctorIds: [1],
      },
    ])
  })

  it('dutyType: the anchor and whole intervals after it are open, all else closed', () => {
    const result = computeEligibility({
      doctors: [doctor(1)],
      unavailability: new Map(),
      days: [
        day('2026-10-01'),
        day('2026-10-02'),
        day('2026-10-09'),
        day('2026-10-10'),
        day('2026-11-11'),
      ],
      ...empty(),
    })
    expect(result.map((d) => [d.date, d.dutyType])).toEqual([
      ['2026-10-01', 'closed'], // before the anchor: never open
      ['2026-10-02', 'open'], // the anchor itself
      ['2026-10-09', 'closed'], // 7 days after the anchor
      ['2026-10-10', 'open'], // one interval after the anchor
      ['2026-11-11', 'open'], // 40 days = 5 intervals, wraps the month
    ])
  })

  it('slotsRequired/slotsMinimum: open, post-open, and closed days report their own counts', () => {
    const result = computeEligibility({
      doctors: [doctor(1)],
      unavailability: new Map(),
      days: [day('2026-10-01'), day('2026-10-02'), day('2026-10-03')],
      ...empty(),
      slots: { openDutySlots: 3, postOpenDutySlots: 4, closedDutySlots: 1 },
      minimums: { openDutyMinimum: 2, postOpenDutyMinimum: 3, closedDutyMinimum: 1 },
    })
    expect(result.map((d) => [d.date, d.slotsRequired, d.slotsMinimum])).toEqual([
      ['2026-10-01', 1, 1],
      ['2026-10-02', 3, 2],
      ['2026-10-03', 4, 3],
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

  it('open on-call cap: a doctor holding an open-day duty -> excluded from other open days', () => {
    // Defaults: anchor 2026-10-02, interval 8 — 10-02 and 10-10 are open.
    const result = computeEligibility({
      doctors: [doctor(1)],
      unavailability: new Map(),
      days: [day('2026-10-02'), day('2026-10-10')],
      ...empty(),
      dutiesByDate: new Map([['2026-10-02', new Set([1])]]),
      dutyCountByDoctor: new Map([[1, 1]]),
      openByDoctor: new Map([[1, 1]]),
    })
    // On their own open day the doctor stays eligible (swap semantics);
    // on another open day they are excluded — never a second open duty.
    expect(result[0]?.eligibleDoctorIds).toEqual([1])
    expect(result[1]?.eligibleDoctorIds).toEqual([])
  })

  it('holiday cap: a critical holiday day stays open to a doctor holding two regular holiday duties', () => {
    // 10-03 is the day after the open anchor (critical); 10-17 is a regular Saturday.
    const result = computeEligibility({
      doctors: [doctor(1)],
      unavailability: new Map(),
      days: [day('2026-10-03', true), day('2026-10-17', true)],
      ...empty(),
      dutyCountByDoctor: new Map([[1, 2]]),
      regularHolidayByDoctor: new Map([[1, 2]]),
    })
    expect(result[0]?.eligibleDoctorIds).toEqual([1])
    expect(result[1]?.eligibleDoctorIds).toEqual([])
  })

  it('holiday cap: critical holiday duties leave less room for regular ones', () => {
    const result = computeEligibility({
      doctors: [doctor(1)],
      unavailability: new Map(),
      days: [day('2026-10-17', true)],
      ...empty(),
      dutyCountByDoctor: new Map([[1, 2]]),
      regularHolidayByDoctor: new Map([[1, 1]]),
      criticalHolidayByDoctor: new Map([[1, 1]]),
    })
    expect(result[0]?.eligibleDoctorIds).toEqual([])
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
