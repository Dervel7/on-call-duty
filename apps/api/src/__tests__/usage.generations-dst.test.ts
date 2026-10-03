import { resolve } from 'node:path'
import { config } from 'dotenv'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const { parsed } = config({ path: resolve(import.meta.dirname, '../../.env') })
if (parsed?.DATABASE_URL) process.env.DATABASE_URL = parsed.DATABASE_URL
// Session time zone with a DST change, so batch timestamps come back as text
// with different UTC offsets ("+03" before the fall-back, "+02" after).
process.env.PGOPTIONS = '-c timezone=Europe/Athens'

// Dynamic imports: the pool must be created after DATABASE_URL/PGOPTIONS are set.
const { query } = await import('../db/client')
const { generations } = await import('../services/usage.service')

const YEAR = 2032
const MONTH = 3
// Athens falls back at 2031-10-26 04:00+03 -> 03:00+02. The later batch has the
// lexically smaller text timestamp.
const EARLIER = '2031-10-26 03:50:00+03'
const LATER = '2031-10-26 03:10:00+02'

describe('generations across a DST fall-back (real database)', () => {
  let doctorIds: number[] = []

  beforeAll(async () => {
    await query(`DELETE FROM schedule_generation_log WHERE year = $1`, [YEAR])
    const doctors = await query<{ id: number }>(
      'SELECT id FROM doctors WHERE clinic_id = 1 ORDER BY id LIMIT 4',
    )
    doctorIds = doctors.rows.map((r) => r.id)
    for (const at of [EARLIER, LATER]) {
      for (const id of doctorIds) {
        await query(
          `INSERT INTO schedule_generation_log (doctor_id, clinic_id, year, month, created_at)
           VALUES ($1, 1, $2, $3, $4::timestamptz)`,
          [id, YEAR, MONTH, at],
        )
      }
    }
  })

  afterAll(async () => {
    await query(`DELETE FROM schedule_generation_log WHERE year = $1`, [YEAR])
  })

  it('compares the later batch with the earlier one, not the other way round', async () => {
    const events = (await generations()).filter((e) => e.year === YEAR && e.month === MONTH)
    expect(events).toHaveLength(2)
    const [later, earlier] = events
    expect(later!.generatedAt).toBe(new Date(LATER).toISOString())
    expect(later!.overlapPercent).toBe(100)
    expect(earlier!.overlapPercent).toBeNull()
  })
})
