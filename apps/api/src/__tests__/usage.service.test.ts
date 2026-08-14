import { resolve } from 'node:path'
import { config } from 'dotenv'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const { parsed } = config({ path: resolve(import.meta.dirname, '../../.env') })
if (parsed?.DATABASE_URL) process.env.DATABASE_URL = parsed.DATABASE_URL

const { query, withTransaction } = await import('../db/client')
const { overlapPercent, recordGeneration } = await import('../services/usage.service')
const { license } = await import('../config/license')

describe('overlapPercent', () => {
  it('returns 100 for identical sets', () => {
    expect(overlapPercent([1, 2, 3], [3, 2, 1])).toBe(100)
  })

  it('returns 100 when either set is empty', () => {
    expect(overlapPercent([], [1, 2])).toBe(100)
    expect(overlapPercent([1, 2], [])).toBe(100)
  })

  it('returns 20 for 10-vs-10 sets sharing 2 doctors', () => {
    const prev = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const next = [1, 2, 11, 12, 13, 14, 15, 16, 17, 18]
    expect(overlapPercent(prev, next)).toBe(20)
  })

  it('divides shared doctors by the larger set size (subset case)', () => {
    expect(overlapPercent([1, 2, 3, 4], [1, 2])).toBe(50)
    expect(overlapPercent([1, 2], [1, 2, 3, 4])).toBe(50)
    expect(overlapPercent([1, 2, 3, 4, 5, 6], [1, 2])).toBeCloseTo(33.33, 2)
  })
})

const YEAR = 2030
const MONTH = 7
const SYNTHETIC_EMAIL_PREFIX = 'usage-t+'
const SYNTHETIC_COUNT = license.doctorAllowance + 2

let runStart = new Date(0)
let groupA: number[] = []
let groupB: number[] = []

function unresolvedCount(type: string): Promise<number> {
  return query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM operator_alerts WHERE type = $1 AND resolved_at IS NULL`,
    [type],
  ).then((r) => r.rows[0]?.n ?? 0)
}

function unresolvedDisjointForMonth(): Promise<number> {
  return query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM operator_alerts
     WHERE type = 'disjoint_regeneration' AND resolved_at IS NULL
       AND detail->>'year' = $1 AND detail->>'month' = $2`,
    [String(YEAR), String(MONTH)],
  ).then((r) => r.rows[0]?.n ?? 0)
}

async function cleanup(): Promise<void> {
  await query(
    `DELETE FROM operator_alerts
     WHERE type IN ('allowance_exceeded', 'disjoint_regeneration') AND created_at >= $1`,
    [runStart],
  )
  await query(
    `DELETE FROM schedule_generation_log
     WHERE year = $1
        OR doctor_id IN (
          SELECT d.id FROM doctors d JOIN users u ON u.id = d.user_id
          WHERE u.email LIKE $2 || '%'
        )`,
    [YEAR, SYNTHETIC_EMAIL_PREFIX],
  )
  await query(`DELETE FROM users WHERE email LIKE $1 || '%'`, [SYNTHETIC_EMAIL_PREFIX])
}

async function deleteLeftoverAlerts(): Promise<void> {
  await query(
    `DELETE FROM operator_alerts
     WHERE (type = 'disjoint_regeneration' AND detail->>'year' = $1 AND detail->>'month' = $2)
        OR (type = 'allowance_exceeded' AND resolved_at IS NULL)`,
    [String(YEAR), String(MONTH)],
  )
}

describe('recordGeneration (real database)', () => {
  beforeAll(async () => {
    const now = await query<{ t: Date }>('SELECT NOW() AS t')
    runStart = now.rows[0]?.t ?? new Date()
    await deleteLeftoverAlerts()
    await cleanup()
    const doctors = await query<{ id: number }>('SELECT id FROM doctors ORDER BY id LIMIT 8')
    groupA = doctors.rows.slice(0, 4).map((r) => r.id)
    groupB = doctors.rows.slice(4, 8).map((r) => r.id)
  })

  afterAll(cleanup)

  it('logs the batch and raises no alerts on the first generation of a month', async () => {
    await withTransaction((client) => recordGeneration(client, YEAR, MONTH, groupA))
    const logged = await query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM schedule_generation_log WHERE year = $1 AND month = $2 AND doctor_id = ANY($3)',
      [YEAR, MONTH, groupA],
    )
    expect(logged.rows[0]?.n).toBe(groupA.length)
    expect(await unresolvedDisjointForMonth()).toBe(0)
    expect(await unresolvedCount('allowance_exceeded')).toBe(0)
  })

  it('raises exactly one disjoint_regeneration alert for a <50% overlap regeneration', async () => {
    await withTransaction((client) => recordGeneration(client, YEAR, MONTH, groupB))
    expect(await unresolvedDisjointForMonth()).toBe(1)
    const alert = await query<{ overlap: number }>(
      `SELECT (detail->>'overlapPercent')::int AS overlap FROM operator_alerts
       WHERE type = 'disjoint_regeneration' AND resolved_at IS NULL
         AND detail->>'year' = $1 AND detail->>'month' = $2`,
      [String(YEAR), String(MONTH)],
    )
    expect(alert.rows[0]?.overlap).toBe(0)
  })

  it('deduplicates: a third disjoint regeneration leaves exactly one unresolved alert', async () => {
    await withTransaction((client) => recordGeneration(client, YEAR, MONTH, groupA))
    expect(await unresolvedDisjointForMonth()).toBe(1)
  })

  it('raises no new alert when regenerating with the same roster', async () => {
    await withTransaction((client) => recordGeneration(client, YEAR, MONTH, groupA))
    expect(await unresolvedDisjointForMonth()).toBe(1)
  })

  it('raises exactly one allowance_exceeded alert when distinct doctors exceed the allowance', async () => {
    await query(
      `INSERT INTO users (email, username, password_hash, role, first_name, last_name, is_active)
       SELECT $1 || g || '@oncall.test', 'usage-t-' || g, 'not-a-real-hash', 'doctor', 'Usage', 'Test' || g, TRUE
       FROM generate_series(1, $2) AS g`,
      [SYNTHETIC_EMAIL_PREFIX, SYNTHETIC_COUNT],
    )
    await query(
      `INSERT INTO doctors (user_id, max_monthly_duties)
       SELECT id, 7 FROM users WHERE email LIKE $1 || '%'`,
      [SYNTHETIC_EMAIL_PREFIX],
    )
    await query(
      `INSERT INTO schedule_generation_log (doctor_id, year, month)
       SELECT d.id, $1, $2 FROM doctors d JOIN users u ON u.id = d.user_id
       WHERE u.email LIKE $3 || '%'`,
      [YEAR, MONTH + 1, SYNTHETIC_EMAIL_PREFIX],
    )

    await withTransaction((client) => recordGeneration(client, YEAR, MONTH, groupA))
    expect(await unresolvedCount('allowance_exceeded')).toBe(1)
    expect(await unresolvedDisjointForMonth()).toBe(1)
  })
})
