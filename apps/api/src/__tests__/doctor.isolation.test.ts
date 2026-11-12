import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { query } from '../db/client.ts'
import { create, getById, list, remove } from '../services/doctor.service.ts'
import { seedTwoClinics, type TwoClinicFixture } from './helpers/clinic-fixtures.ts'

// Live-DB isolation matrix (section 5 I4/I5).
let f: TwoClinicFixture | undefined

beforeAll(async () => {
  f = await seedTwoClinics()
})

afterAll(async () => {
  await f?.dispose()
})

function newDoctor(suffix: string) {
  return {
    email: `iso-new-${suffix}@test.local`,
    username: `isonew${suffix}`,
    password: 'secret1',
    firstName: 'New',
    lastName: 'Doc',
    maxMonthlyDuties: 7,
  }
}

/** Fixture dispose does not know doctors created inside a test. */
async function deleteDoctorUser(userId: number): Promise<void> {
  await query(`DELETE FROM doctors WHERE user_id = $1`, [userId])
  await query(`DELETE FROM users WHERE id = $1`, [userId])
}

describe('doctor clinic isolation (live DB)', () => {
  it('admin A lists only clinic A doctors (I4)', async () => {
    const doctors = await list({ clinicId: f!.clinicA })
    expect(doctors.length).toBeGreaterThanOrEqual(1)
    expect(doctors.every((d) => d.clinicId === f!.clinicA)).toBe(true)
  })

  it('created doctor carries the scope clinic in both tables (I5, equality invariant)', async () => {
    const d = await create(
      newDoctor(Date.now().toString(36)),
      { id: f!.adminA, role: 'administrator', clinicId: f!.clinicA },
      { clinicId: f!.clinicA },
    )
    try {
      expect(d.clinicId).toBe(f!.clinicA)
      const res = await query<{ users_clinic: number; doctors_clinic: number }>(
        `SELECT u.clinic_id AS users_clinic, d.clinic_id AS doctors_clinic
         FROM users u JOIN doctors d ON d.user_id = u.id WHERE u.id = $1`,
        [d.userId],
      )
      const row = res.rows[0]
      expect(row?.users_clinic).toBe(f!.clinicA)
      expect(row?.doctors_clinic).toBe(row?.users_clinic)
    } finally {
      await deleteDoctorUser(d.userId)
    }
  })

  it('admin A cannot read clinic B doctor (404)', async () => {
    await expect(
      getById(f!.doctorRowB, { id: f!.adminA, role: 'administrator', clinicId: f!.clinicA }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('a removed doctor is hidden and its email and username can be reused', async () => {
    const actor = { id: f!.adminA, role: 'administrator', clinicId: f!.clinicA } as const
    const input = newDoctor(`del-${Date.now().toString(36)}`)
    const first = await create(input, actor, { clinicId: f!.clinicA })
    let second: { id: number; userId: number } | undefined
    try {
      await remove(first.id, actor)
      await expect(getById(first.id, actor)).rejects.toMatchObject({ status: 404 })
      second = await create(input, actor, { clinicId: f!.clinicA })
      expect(second.id).not.toBe(first.id)
    } finally {
      await deleteDoctorUser(first.userId)
      if (second) await deleteDoctorUser(second.userId)
    }
  })
})
