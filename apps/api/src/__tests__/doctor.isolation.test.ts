import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TwoClinicFixture } from './helpers/clinic-fixtures'

// Live-DB isolation matrix (§5 I4/I5): env bootstrap must run before the
// service loads db/client, hence the ordered dynamic imports.
const { seedTwoClinics } = await import('./helpers/clinic-fixtures')
const { query } = await import('../db/client')
const { create, getById, list } = await import('../services/doctor.service')

let f: TwoClinicFixture | undefined

beforeAll(async () => {
  f = await seedTwoClinics()
})

afterAll(async () => {
  await f?.dispose()
})

describe('doctor clinic isolation (live DB)', () => {
  it('admin A lists only clinic A doctors (I4)', async () => {
    const doctors = await list({ kind: 'clinic', clinicId: f!.clinicA })
    expect(doctors.length).toBeGreaterThanOrEqual(1)
    expect(doctors.every((d) => d.clinicId === f!.clinicA)).toBe(true)
  })

  it('created doctor carries the scope clinic in both tables (I5, equality invariant)', async () => {
    const suffix = Date.now().toString(36)
    const d = await create(
      {
        email: `iso-new-${suffix}@test.local`,
        username: `isonew${suffix}`,
        password: 'secret1',
        firstName: 'New',
        lastName: 'Doc',
      },
      { id: f!.adminA, role: 'administrator', clinicId: f!.clinicA },
      { kind: 'clinic', clinicId: f!.clinicA },
    )
    expect(d.clinicId).toBe(f!.clinicA)
    const res = await query<{ users_clinic: number; doctors_clinic: number }>(
      `SELECT u.clinic_id AS users_clinic, d.clinic_id AS doctors_clinic
       FROM users u JOIN doctors d ON d.user_id = u.id WHERE u.id = $1`,
      [d.userId],
    )
    const row = res.rows[0]
    expect(row?.users_clinic).toBe(f!.clinicA)
    expect(row?.doctors_clinic).toBe(row?.users_clinic)
    // cleanup the created doctor (fixture dispose does not know it)
    await query(`DELETE FROM doctors WHERE user_id = $1`, [d.userId])
    await query(`DELETE FROM users WHERE id = $1`, [d.userId])
  })

  it('admin A cannot read clinic B doctor (404)', async () => {
    await expect(
      getById(f!.doctorRowB, { id: f!.adminA, role: 'administrator', clinicId: f!.clinicA }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
