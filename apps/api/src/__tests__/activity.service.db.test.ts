import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { query } from '../db/client.ts'
import { list } from '../services/activity.service.ts'
import { seedTwoClinics, type TwoClinicFixture } from './helpers/clinic-fixtures.ts'

describe('activity.service list date range (real database)', () => {
  let fx: TwoClinicFixture

  beforeAll(async () => {
    fx = await seedTwoClinics()
    await query(
      `INSERT INTO activity_log (user_id, clinic_id, action, entity_type, created_at)
       VALUES ($1, $2, 'auth.login', 'auth', '2026-07-31T23:59:59Z'),
              ($1, $2, 'auth.login', 'auth', '2026-08-01T00:00:00Z'),
              ($1, $2, 'auth.login', 'auth', '2026-08-31T23:59:59Z'),
              ($1, $2, 'auth.login', 'auth', '2026-09-01T00:00:00Z')`,
      [fx.adminA, fx.clinicA],
    )
  })

  afterAll(() => fx.dispose())

  it('includes the whole last day of the range and nothing outside it', async () => {
    const page = await list({ from: '2026-08-01', to: '2026-08-31' }, { clinicId: fx.clinicA })
    expect(page.items.map((i) => i.createdAt).sort()).toEqual([
      '2026-08-01T00:00:00.000Z',
      '2026-08-31T23:59:59.000Z',
    ])
  })
})
