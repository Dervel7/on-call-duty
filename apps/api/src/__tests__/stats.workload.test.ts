import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TwoClinicFixture } from './helpers/clinic-fixtures'

// Live-DB test: the fixture helper loads DATABASE_URL before db/client is imported.
const { seedTwoClinics } = await import('./helpers/clinic-fixtures')
const { query } = await import('../db/client')
const { adminStats } = await import('../services/stats.service')

let fx: TwoClinicFixture

beforeAll(async () => {
  fx = await seedTwoClinics()
})

afterAll(async () => {
  await fx.dispose()
})

describe('stats.service adminStats workload (live DB)', () => {
  it('keeps a doctor moved to another clinic in the old schedule workload', async () => {
    const sched = await query<{ id: number }>(
      `INSERT INTO schedules (clinic_id, year, month, status) VALUES ($1, 2026, 9, 'published') RETURNING id`,
      [fx.clinicA],
    )
    await query(
      `INSERT INTO duties (schedule_id, duty_date, doctor_id, is_weekend, reason)
       VALUES ($1, '2026-09-05', $2, TRUE, 'plan'), ($1, '2026-09-08', $2, FALSE, 'plan')`,
      [sched.rows[0]?.id, fx.doctorRowA],
    )
    // Superadmin clinic move (user.service.update syncs doctors.clinic_id).
    await query(`UPDATE users SET clinic_id = $1 WHERE id = $2`, [fx.clinicB, fx.doctorA])
    await query(`UPDATE doctors SET clinic_id = $1 WHERE id = $2`, [fx.clinicB, fx.doctorRowA])

    const stats = await adminStats(2026, 9, { kind: 'clinic', clinicId: fx.clinicA })

    const moved = stats.workload.find((w) => w.doctorId === fx.doctorRowA)
    expect(moved).toMatchObject({ duties: 2, weekend: 1, weekday: 1, isActive: true })
    expect(stats.workload.some((w) => w.doctorId === fx.doctorRowB)).toBe(false)
  })
})
