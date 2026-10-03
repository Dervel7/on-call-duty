import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TwoClinicFixture } from './helpers/clinic-fixtures'

// Live-DB test: the fixture helper loads DATABASE_URL before db/client is imported.
const { seedTwoClinics } = await import('./helpers/clinic-fixtures')
const { query } = await import('../db/client')
const { list } = await import('../services/activity.service')

let fx: TwoClinicFixture

beforeAll(async () => {
  fx = await seedTwoClinics()
  // Auth events are recorded without a clinic (auth.service logActivity).
  await query(
    `INSERT INTO activity_log (user_id, clinic_id, action, entity_type, entity_id)
     VALUES ($1, NULL, 'auth.login', 'auth', NULL),
            ($2, NULL, 'auth.login', 'auth', NULL),
            ($1, $3, 'holidays.updated', 'holidays', NULL)`,
    [fx.adminA, fx.adminB, fx.clinicA],
  )
})

afterAll(async () => {
  await query(`DELETE FROM activity_log WHERE user_id IN ($1, $2)`, [fx.adminA, fx.adminB])
  await fx.dispose()
})

describe('activity.service list clinic scope (live DB)', () => {
  it("shows clinic-less events of the clinic's own users, not of other clinics", async () => {
    const page = await list({}, { kind: 'clinic', clinicId: fx.clinicA })
    expect(page.total).toBe(2)
    expect(page.items.map((e) => [e.action, e.actor?.id])).toEqual(
      expect.arrayContaining([
        ['auth.login', fx.adminA],
        ['holidays.updated', fx.adminA],
      ]),
    )
  })

  it('the auth.login filter finds the logins of the clinic users', async () => {
    const page = await list({ action: 'auth.login' }, { kind: 'clinic', clinicId: fx.clinicB })
    expect(page.total).toBe(1)
    expect(page.items[0]?.actor?.id).toBe(fx.adminB)
  })
})
