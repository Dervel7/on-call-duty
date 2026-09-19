import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TwoClinicFixture } from './helpers/clinic-fixtures'

// Live-DB isolation matrix for schedules (§5 I7-I11). Env bootstrap must run
// before the service loads db/client, hence the ordered dynamic imports.
const { seedTwoClinics } = await import('./helpers/clinic-fixtures')
const { query } = await import('../db/client')
const scheduleService = await import('../services/schedule.service')

let f: TwoClinicFixture | undefined
const scheduleIds: number[] = []

/** Two doctors per clinic so a minimal manual plan can satisfy caps. */
async function addDoctor(clinicId: number, name: string): Promise<{ userId: number; doctorId: number }> {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const u = await query<{ id: number }>(
    `INSERT INTO users (email, username, password_hash, role, first_name, last_name, clinic_id)
     VALUES ($1, $2, 'x', 'doctor', $3, 'Iso', $4) RETURNING id`,
    [`iso-${name}-${suffix}@test.local`, `iso${name}${suffix}`.slice(0, 32), name, clinicId],
  )
  const userId = u.rows[0]!.id
  const d = await query<{ id: number }>(
    `INSERT INTO doctors (user_id, clinic_id, max_monthly_duties) VALUES ($1, $2, 7) RETURNING id`,
    [userId, clinicId],
  )
  return { userId, doctorId: d.rows[0]!.id }
}

beforeAll(async () => {
  f = await seedTwoClinics()
})

afterAll(async () => {
  if (scheduleIds.length > 0) {
    await query(`DELETE FROM duties WHERE schedule_id IN ($1, $2)`, [scheduleIds[0]!, scheduleIds[1] ?? scheduleIds[0]!])
    await query(`DELETE FROM schedules WHERE id IN ($1, $2)`, [scheduleIds[0]!, scheduleIds[1] ?? scheduleIds[0]!])
  }
  await f?.dispose()
})

const adminA = () => ({ id: f!.adminA, role: 'administrator' as const, clinicId: f!.clinicA })
const scopeA = () => ({ kind: 'clinic' as const, clinicId: f!.clinicA })

describe('schedule clinic isolation (live DB)', () => {
  it('two clinics hold a schedule for the same month (D6/I8)', async () => {
    const ins = await query<{ id: number }>(
      `INSERT INTO schedules (clinic_id, year, month, status)
       VALUES ($1, 2031, 3, 'draft'), ($2, 2031, 3, 'draft') RETURNING id`,
      [f!.clinicA, f!.clinicB],
    )
    scheduleIds.push(ins.rows[0]!.id, ins.rows[1]!.id)
    expect(scheduleIds).toHaveLength(2)

    // generate pre-check for clinic A does not see clinic B's schedule.
    const exists = await query(
      `SELECT id FROM schedules WHERE year = 2031 AND month = 3 AND clinic_id = $1`,
      [f!.clinicA],
    )
    expect(exists.rows.length).toBe(1)
  })

  it('admin A cannot read/publish clinic B schedule (404, I7/I10)', async () => {
    const scheduleB = scheduleIds[1]!
    await expect(scheduleService.getById(scheduleB, adminA())).rejects.toMatchObject({ status: 404 })
    await expect(scheduleService.publish(scheduleB, adminA())).rejects.toMatchObject({ status: 404 })
    await expect(scheduleService.remove(scheduleB, adminA())).rejects.toMatchObject({ status: 404 })
  })

  it('addDuty: cross-clinic doctor is 404 (I9); adjacency ignores other clinics (I11)', async () => {
    const scheduleA = scheduleIds[0]!
    const docA = await addDoctor(f!.clinicA, 'aa')
    const docB = await addDoctor(f!.clinicB, 'bb')

    // Cross-clinic doctor cannot be assigned into clinic A's schedule.
    await expect(
      scheduleService.addDuty(scheduleA, { date: '2031-03-10', doctorId: docB.doctorId }, adminA()),
    ).rejects.toMatchObject({ status: 404 })

    // Doctor A on 03-10 must NOT block doctor A2 on 03-11 in clinic B's eyes...
    // but first prove the block exists within clinic A (same clinic → 409).
    await scheduleService.addDuty(scheduleA, { date: '2031-03-10', doctorId: docA.doctorId }, adminA())
    await expect(
      scheduleService.addDuty(scheduleA, { date: '2031-03-11', doctorId: docA.doctorId }, adminA()),
    ).rejects.toMatchObject({ status: 409 })

    // Same date pair in clinic B: doctor A's 03-10 duty must not block B's
    // doctor on 03-11 (adjacency independence).
    const scheduleB = scheduleIds[1]!
    const dutyB = await scheduleService.addDuty(
      scheduleB,
      { date: '2031-03-11', doctorId: docB.doctorId },
      { id: f!.adminB, role: 'administrator', clinicId: f!.clinicB },
    )
    expect(dutyB.doctorId).toBe(docB.doctorId)

    // preview pool is clinic-scoped: clinic B preview only uses B's doctors
    // (the fixture doctor and docB) — never clinic A's.
    const res = await scheduleService.preview(2031, 4, { kind: 'clinic', clinicId: f!.clinicB })
    const clinicBDoctors = new Set([docB.doctorId, f!.doctorRowB])
    expect(res.assignments.length).toBeGreaterThan(0)
    expect(res.assignments.every((a) => clinicBDoctors.has(a.doctorId))).toBe(true)
  })

  it('list is clinic-scoped (I6)', async () => {
    const a = await scheduleService.list({ year: 2031, month: 3 }, adminA(), scopeA())
    expect(a).toHaveLength(1)
    expect(a[0]?.clinicId).toBe(f!.clinicA)
    const b = await scheduleService.list(
      { year: 2031, month: 3 },
      { id: f!.adminB, role: 'administrator', clinicId: f!.clinicB },
      { kind: 'clinic', clinicId: f!.clinicB },
    )
    expect(b).toHaveLength(1)
    expect(b[0]?.clinicId).toBe(f!.clinicB)
  })
})
