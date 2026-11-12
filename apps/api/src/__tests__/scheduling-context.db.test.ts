import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { query } from '../db/client.ts'
import { buildContext } from '../services/scheduling-context.ts'
import { seedTwoClinics, type TwoClinicFixture } from './helpers/clinic-fixtures.ts'

describe('buildContext (real database)', () => {
  let fx: TwoClinicFixture

  beforeAll(async () => {
    fx = await seedTwoClinics()
    await query(`INSERT INTO holidays (clinic_id, holiday_date) VALUES ($1, '2026-09-09'), ($2, '2026-09-10')`, [
      fx.clinicA,
      fx.clinicB,
    ])
    await query(
      `INSERT INTO unavailability (doctor_id, start_date, end_date, is_disabled)
       VALUES ($1, '2026-09-14', '2026-09-15', FALSE), ($1, '2026-09-20', '2026-09-21', TRUE)`,
      [fx.doctorRowA],
    )
  })

  afterAll(async () => {
    await query(`DELETE FROM holidays WHERE clinic_id IN ($1, $2)`, [fx.clinicA, fx.clinicB])
    await fx.dispose()
  })

  it('counts a marked weekday of this clinic, and only this clinic, as a holiday', async () => {
    const ctx = await buildContext(2026, 9, fx.clinicA)
    const holidayDates = ctx.days.filter((d) => d.isHoliday && !d.isWeekend).map((d) => d.date)
    expect(holidayDates).toEqual(['2026-09-09'])
  })

  it('ignores a disabled unavailability range', async () => {
    const ctx = await buildContext(2026, 9, fx.clinicA)
    expect(ctx.unavailability.get(fx.doctorRowA)).toEqual([{ start: '2026-09-14', end: '2026-09-15' }])
  })
})
