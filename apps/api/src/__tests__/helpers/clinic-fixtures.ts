import { resolve } from 'node:path'
import { config } from 'dotenv'

const { parsed } = config({ path: resolve(import.meta.dirname, '../../../.env') })
if (parsed?.DATABASE_URL) process.env.DATABASE_URL = parsed.DATABASE_URL

// db/client builds its Pool at import time, so it must load after DATABASE_URL
// is set — a static import would hoist above the config() call.
const { default: bcrypt } = await import('bcrypt')
const { query } = await import('../../db/client')

export interface TwoClinicFixture {
  clinicA: number
  clinicB: number
  adminA: number
  adminB: number
  doctorA: number
  doctorB: number
  /** doctors-table id of each seeded doctor */
  doctorRowA: number
  doctorRowB: number
  dispose: () => Promise<void>
}

const PASSWORD_HASH = bcrypt.hashSync('test-pass-123', 4)

/**
 * Live-DB fixture for cross-tenant isolation tests (§5 matrix): two clinics,
 * each with one administrator and one doctor. Names/emails are unique per run
 * so parallel suites never collide. Call dispose() in afterAll.
 */
export async function seedTwoClinics(): Promise<TwoClinicFixture> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const clinics = await query<{ id: number }>(
    `INSERT INTO clinics (name) VALUES ($1), ($2) RETURNING id`,
    [`Iso Clinic A ${suffix}`, `Iso Clinic B ${suffix}`],
  )
  const clinicA = clinics.rows[0]?.id
  const clinicB = clinics.rows[1]?.id

  const admins = await query<{ id: number }>(
    `INSERT INTO users (email, username, password_hash, role, first_name, last_name, clinic_id)
     VALUES
       ($1, $2, $4, 'administrator', 'Ada', 'AdminA', $6),
       ($3, $5, $4, 'administrator', 'Ben', 'AdminB', $7)
     RETURNING id`,
    [
      `iso-admin-a-${suffix}@test.local`,
      `isoa-${suffix}`,
      `iso-admin-b-${suffix}@test.local`,
      PASSWORD_HASH,
      `isob-${suffix}`,
      clinicA,
      clinicB,
    ],
  )

  const doctorUsers = await query<{ id: number }>(
    `INSERT INTO users (email, username, password_hash, role, first_name, last_name, clinic_id)
     VALUES
       ($1, $2, $4, 'doctor', 'Doc', 'DocA', $6),
       ($3, $5, $4, 'doctor', 'Doc', 'DocB', $7)
     RETURNING id`,
    [
      `iso-doc-a-${suffix}@test.local`,
      `isoda-${suffix}`,
      `iso-doc-b-${suffix}@test.local`,
      PASSWORD_HASH,
      `isodb-${suffix}`,
      clinicA,
      clinicB,
    ],
  )

  const adminA = admins.rows[0]?.id
  const adminB = admins.rows[1]?.id
  const doctorA = doctorUsers.rows[0]?.id
  const doctorB = doctorUsers.rows[1]?.id
  if (
    clinicA === undefined ||
    clinicB === undefined ||
    adminA === undefined ||
    adminB === undefined ||
    doctorA === undefined ||
    doctorB === undefined
  ) {
    throw new Error('clinic fixture seeding failed')
  }

  const doctorRows = await query<{ id: number; user_id: number }>(
    `INSERT INTO doctors (user_id, clinic_id, max_monthly_duties)
     VALUES ($1, $3, 7), ($2, $4, 7) RETURNING id, user_id`,
    [doctorA, doctorB, clinicA, clinicB],
  )
  const doctorRowA = doctorRows.rows.find((r) => r.user_id === doctorA)?.id
  const doctorRowB = doctorRows.rows.find((r) => r.user_id === doctorB)?.id
  if (doctorRowA === undefined || doctorRowB === undefined) {
    throw new Error('clinic fixture doctor seeding failed')
  }

  async function dispose() {
    // Everything a test can anchor to these two clinics, child-first.
    await query(
      `DELETE FROM unavailability WHERE doctor_id IN (SELECT d.id FROM doctors d WHERE d.clinic_id IN ($1, $2))`,
      [clinicA, clinicB],
    )
    await query(
      `DELETE FROM duties WHERE schedule_id IN (SELECT s.id FROM schedules s WHERE s.clinic_id IN ($1, $2))`,
      [clinicA, clinicB],
    )
    await query(`DELETE FROM schedule_generation_log WHERE clinic_id IN ($1, $2)`, [clinicA, clinicB])
    await query(`DELETE FROM schedules WHERE clinic_id IN ($1, $2)`, [clinicA, clinicB])
    await query(`DELETE FROM doctors WHERE clinic_id IN ($1, $2)`, [clinicA, clinicB])
    await query(`DELETE FROM activity_log WHERE clinic_id IN ($1, $2)`, [clinicA, clinicB])
    await query(`DELETE FROM users WHERE clinic_id IN ($1, $2)`, [clinicA, clinicB])
    await query(`DELETE FROM clinics WHERE id IN ($1, $2)`, [clinicA, clinicB])
  }

  return {
    clinicA,
    clinicB,
    adminA,
    adminB,
    doctorA,
    doctorB,
    doctorRowA,
    doctorRowB,
    dispose,
  }
}
