import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client.ts', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

const recordActivity = vi.fn()
vi.mock('../services/activity.service.ts', () => ({
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

import { addDuty, reassignDuty, removeDuty } from '../services/duty.service.ts'
import { scheduleRow, SEEDED_MINIMUMS } from './helpers/schedule-fixtures.ts'

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

beforeEach(() => {
  query.mockReset()
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

describe('duty.service', () => {
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
})
