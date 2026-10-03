import { afterAll, describe, expect, it } from 'vitest'

// Live-DB test: the fixture helper loads DATABASE_URL before db/client is imported.
await import('./helpers/clinic-fixtures')
const { query } = await import('../db/client')
const { create } = await import('../services/clinic.service')

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const name = `Race Clinic ${suffix}`

afterAll(async () => {
  await query(`DELETE FROM clinics WHERE LOWER(name) = LOWER($1)`, [name])
})

describe('clinic.service (live DB)', () => {
  it('concurrent creates differing only in case leave exactly one clinic', async () => {
    const results = await Promise.allSettled([
      create({ name }),
      create({ name: name.toUpperCase() }),
      create({ name: name.toLowerCase() }),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const res = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM clinics WHERE LOWER(name) = LOWER($1)`,
      [name],
    )
    expect(res.rows[0]?.n).toBe(1)
  })
})
