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
const SCOPE = { kind: 'clinic', clinicId: 1 } as const

beforeEach(() => {
  query.mockReset()
  logActivity.mockReset()
  recordActivity.mockReset()
})

describe('schedule.service', () => {
  it('generate 409 when the month already exists', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    await expect(generate(2026, 9, { id: 2, role: 'administrator', clinicId: 1 }, SCOPE)).rejects.toMatchObject({
      status: 409,
    })
  })

  it('generate 422 when a day is unfillable (no doctors) and persists nothing', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(generate(2026, 9, { id: 2, role: 'administrator', clinicId: 1 }, SCOPE)).rejects.toMatchObject({
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
      if (sql.includes('FROM unavailability')) return { rows: [] }
      if (sql.includes('FROM duties WHERE duty_date =')) return { rows: [] }
      if (sql.includes('INSERT INTO schedules')) return { rows: [{ id: 42 }] }
      if (sql.includes('INSERT INTO duties')) return { rows: [] }
      if (sql.includes('FROM schedules') && sql.includes('WHERE s.id =')) {
        return { rows: [scheduleRow({ id: 42 })] }
      }
      if (sql.includes('FROM duties du')) return { rows: [] }
      return { rows: [] }
    })
    const detail = await generate(2026, 9, { id: 2, role: 'administrator', clinicId: 1 }, SCOPE)
    expect(detail.schedule.id).toBe(42)
    expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO schedules'))).toBe(true)
    expect(query.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO duties')).length).toBeGreaterThan(0)
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'schedule.generated', entityId: 42 }),
    )
  })

  it('preview returns assignments + conflicts without persisting', async () => {
    query.mockResolvedValue({ rows: [] })
    const res = await preview(2026, 9, SCOPE)
    expect(Array.isArray(res.assignments)).toBe(true)
    expect(Array.isArray(res.conflicts)).toBe(true)
    expect(query.mock.calls.some((c) => String(c[0]).startsWith('INSERT'))).toBe(false)
  })

  it('preview returns per-day eligible doctors and boundary adjacency data', async () => {
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM doctors d JOIN users')) {
        return {
          rows: Array.from({ length: 12 }, (_, i) => ({
            id: i + 1,
            max_monthly_duties: 7,
            first_name: 'D',
            last_name: 'D',
            is_active: true,
          })),
        }
      }
      return { rows: [] }
    })
    const res = await preview(2026, 9, SCOPE)
    expect(res.days).toHaveLength(30)
    // Preview is admin-only; the computed eligibility is returned, not blanked.
    expect(res.days.some((d) => d.eligibleDoctorIds.length > 0)).toBe(true)
    expect(res.days.every((d) => Array.isArray(d.availableDoctorIds))).toBe(true)
  })

  it('preview with a plan computes eligibility against the sent plan', async () => {
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM doctors d JOIN users')) {
        return {
          rows: [
            { id: 1, max_monthly_duties: 7, first_name: 'Ann', last_name: 'One', is_active: true },
            { id: 2, max_monthly_duties: 7, first_name: 'Bob', last_name: 'Two', is_active: true },
          ],
        }
      }
      return { rows: [] }
    })
    const res = await preview(2026, 9, SCOPE, [
      { date: '2026-09-01', doctorId: 1, reason: 'manual override' },
      { date: '2026-09-03', doctorId: 1 },
    ])
    expect(res.assignments).toEqual([
      { date: '2026-09-01', doctorId: 1, doctorFirstName: 'Ann', doctorLastName: 'One', isWeekend: false, reason: 'manual override' },
      { date: '2026-09-03', doctorId: 1, doctorFirstName: 'Ann', doctorLastName: 'One', isWeekend: false, reason: 'plan' },
    ])
    expect(res.conflicts).toEqual([])
    const byDate = new Map(res.days.map((d) => [d.date, d]))
    expect(byDate.get('2026-09-01')?.eligibleDoctorIds).toEqual([1, 2])
    // Doctor 1 is on duty on the 1st and the 3rd, so the 2nd is back-to-back.
    expect(byDate.get('2026-09-02')?.eligibleDoctorIds).toEqual([2])
    expect(query.mock.calls.some((c) => String(c[0]).startsWith('INSERT'))).toBe(false)
  })

  it('preview with a plan applies monthly caps with own-day swap semantics', async () => {
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM doctors d JOIN users')) {
        return {
          rows: [
            { id: 1, max_monthly_duties: 7, first_name: 'Ann', last_name: 'One', is_active: true },
            { id: 2, max_monthly_duties: 7, first_name: 'Bob', last_name: 'Two', is_active: true },
          ],
        }
      }
      return { rows: [] }
    })
    // Seven weekday duties (no two adjacent) put doctor 1 at the 7/month cap.
    const plan = ['01', '03', '07', '09', '11', '15', '17'].map((d) => ({
      date: `2026-09-${d}`,
      doctorId: 1,
 }))
    const res = await preview(2026, 9, SCOPE, plan)
    const byDate = new Map(res.days.map((d) => [d.date, d]))
    // At cap everywhere except…
    expect(byDate.get('2026-09-21')?.eligibleDoctorIds).toEqual([2])
    // …his own days, where the duty being swapped is subtracted from the count.
    expect(byDate.get('2026-09-15')?.eligibleDoctorIds).toEqual([1, 2])
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

  it('addDuty rejects a date with both slots filled (409)', async () => {
    query.mockResolvedValueOnce({ rows: [scheduleRow()] })
    query.mockResolvedValueOnce({ rows: [{ n: 2 }] })
    await expect(
      addDuty(1, { date: '2026-09-05', doctorId: 5 }, { id: 2, role: 'administrator', clinicId: 1 }),
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
      addDuty(1, { date: '2026-09-05', doctorId: 5 }, { id: 2, role: 'administrator', clinicId: 1 }),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('already assigned to this date'),
    })
  })

  it('addDuty inserts the duty and records the audit row in-transaction', async () => {
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FOR UPDATE')) return { rows: [{ status: 'draft' }] }
      if (sql.includes('FROM schedules') && sql.includes('WHERE s.id =')) {
        return { rows: [scheduleRow()] }
      }
      if (sql.includes('FROM duties WHERE schedule_id = $1 AND duty_date =')) {
        return { rows: [{ n: 0 }] }
      }
      if (sql.includes('FROM doctors d JOIN users') && sql.includes('WHERE d.id = $1')) {
        return { rows: [{ max_monthly_duties: 7, is_active: true }] }
      }
      if (sql.includes('WHERE u.is_active = TRUE')) return { rows: [{ n: 8 }] }
      if (sql.includes('FROM unavailability WHERE doctor_id')) return { rows: [] }
      if (sql.includes('FROM duties WHERE schedule_id = $1 AND doctor_id')) {
        return { rows: [{ n: 0 }] }
      }
      if (sql.includes('EXTRACT(ISODOW')) return { rows: [{ n: 0 }] }
      if (sql.includes('du.duty_date IN')) return { rows: [] }
      if (sql.includes('INSERT INTO duties')) return { rows: [{ id: 11 }] }
      if (sql.includes('FROM duties du') && sql.includes('WHERE du.id = $1')) {
        return { rows: [dutyRow({ id: 11 })] }
      }
      return { rows: [] }
    })
    const d = await addDuty(1, { date: '2026-09-05', doctorId: 5 }, { id: 2, role: 'administrator', clinicId: 1 })
    expect(d.id).toBe(11)
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'duty.assigned', entityId: 11 }),
    )
  })

  it('reassignDuty runs validateAssignment and updates the row', async () => {
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM duties du') && sql.includes('WHERE du.id = $1')) {
        return { rows: [dutyRow({ id: 10, doctor_id: 7, duty_date: '2026-09-05', reason: 'manual override by admin #2' })] }
      }
      if (sql.includes('FROM schedules s JOIN clinics') && sql.includes('WHERE s.id = $1')) {
        return { rows: [scheduleRow()] }
      }
      if (sql.includes('FOR UPDATE')) return { rows: [{ status: 'draft' }] }
      if (sql.includes('FROM doctors d JOIN users') && sql.includes('WHERE d.id = $1')) {
        return { rows: [{ max_monthly_duties: 7, is_active: true }] }
      }
      if (sql.includes('WHERE u.is_active = TRUE')) return { rows: [{ n: 8 }] }
      if (sql.includes('FROM unavailability WHERE doctor_id')) return { rows: [] }
      if (sql.includes('EXTRACT(ISODOW')) return { rows: [{ n: 0 }] }
      if (sql.includes('duty_date IN')) return { rows: [] }
      if (sql.includes('UPDATE duties')) return { rows: [] }
      return { rows: [{ n: 0 }] }
    })
    const d = await reassignDuty(10, { doctorId: 7 }, { id: 2, role: 'administrator', clinicId: 1 })
    expect(d.doctorId).toBe(7)
    expect(d.reason).toContain('manual override by admin #2')
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'duty.reassigned', entityId: 10 }),
    )
  })

  it('reassignDuty 404 when duty missing', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(
      reassignDuty(99, { doctorId: 7 }, { id: 2, role: 'administrator', clinicId: 1 }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('removeDuty deletes; 404 when missing', async () => {
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM duties du') && sql.includes('WHERE du.id = $1')) {
        return { rows: [dutyRow()] }
      }
      if (sql.includes('FROM schedules s JOIN clinics') && sql.includes('WHERE s.id = $1')) {
        return { rows: [scheduleRow()] }
      }
      if (sql.includes('FOR UPDATE')) return { rows: [{ status: 'draft' }] }
      return { rows: [] }
    })
    await removeDuty(10, { id: 2, role: 'administrator', clinicId: 1 })
    expect(query.mock.calls.some((c) => String(c[0]).includes('DELETE FROM duties'))).toBe(true)
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'duty.removed', entityId: 10 }),
    )

    query.mockReset()
    logActivity.mockReset()
    query.mockResolvedValue({ rows: [] })
    await expect(removeDuty(99, { id: 2, role: 'administrator', clinicId: 1 })).rejects.toMatchObject({
      status: 404,
    })
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

  it('persists a valid 1-doctor-per-day plan (relaxed rule)', async () => {
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

  it('409 when a plan collides with the prior month last-day duty', async () => {
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM schedules') && sql.includes('year =')) return { rows: [] }
      if (sql.includes('FROM doctors d JOIN users')) return { rows: doctors }
      if (sql.includes('FROM unavailability')) return { rows: [] }
      if (sql.includes('du.duty_date = $1 AND s.clinic_id')) return { rows: [{ doctor_id: 1 }] }
      return { rows: [] }
    })

    const assignments = [
      { date: '2026-09-01', doctorId: 1 },
      ...Array.from({ length: 29 }, (_, i) => ({
        date: `2026-09-${String(i + 2).padStart(2, '0')}`,
        doctorId: (i % 10) + 2,
      })),
    ]
    await expect(
      generate(2026, 9, { id: 2, role: 'administrator', clinicId: 1 }, SCOPE, assignments),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('back-to-back') })
  })

  it('treats an empty assignments array as the engine path (not plan path)', async () => {
    mockContext()
    const detail = await generate(2026, 9, { id: 2, role: 'administrator', clinicId: 1 }, SCOPE, [])
    expect(detail.schedule.id).toBe(7)
    expect(
      query.mock.calls.filter((c) => String(c[0]).includes('INSERT INTO duties')).length,
    ).toBeGreaterThan(0)
  })
})

describe('publish / unpublish', () => {
  it('publish 409 when a day is left uncovered', async () => {
    query
      .mockResolvedValueOnce({ rows: [scheduleRow()] }) // select (draft)
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // UPDATE matches
      .mockResolvedValueOnce({ rows: [{ n: 29 }] }) // coverage count
    await expect(publish(1, { id: 2, role: 'administrator', clinicId: 1 })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('incomplete'),
    })
    expect(recordActivity).not.toHaveBeenCalled()
  })
  it('publish flips draft->published; 404 missing; 409 already published', async () => {
    query
      .mockResolvedValueOnce({ rows: [scheduleRow()] }) // select (draft)
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // UPDATE matches
      .mockResolvedValueOnce({ rows: [{ n: 30 }] }) // coverage
      .mockResolvedValueOnce({ rows: [scheduleRow({ status: 'published' })] }) // re-select
    const published = await publish(1, { id: 2, role: 'administrator', clinicId: 1 })
    expect(published.status).toBe('published')
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'schedule.published', entityId: 1 }),
    )

    query.mockReset()
    logActivity.mockReset()
    query.mockResolvedValueOnce({ rows: [] }) // select finds nothing -> 404
    await expect(publish(99, { id: 2, role: 'administrator', clinicId: 1 })).rejects.toMatchObject({
      status: 404,
    })

    query.mockReset()
    query.mockResolvedValueOnce({ rows: [scheduleRow({ status: 'published' })] }) // select finds it
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
  const day = (date: string, isWeekend = false) => ({
    date,
    dayOfWeek: new Date(`${date}T00:00:00Z`).getUTCDay(),
    isWeekend,
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
      { date: '2026-09-10', isWeekend: false, eligibleDoctorIds: [1], availableDoctorIds: [1] },
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
