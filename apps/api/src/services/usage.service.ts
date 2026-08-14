import type { PoolClient } from 'pg'
import { license } from '../config/license'

/** Share of `next` doctors already present in `prev`, as a percentage of the larger set. */
export function overlapPercent(prev: number[], next: number[]): number {
  if (prev.length === 0 || next.length === 0) return 100
  const p = new Set(prev)
  const shared = next.filter((id) => p.has(id)).length
  return (shared / Math.max(prev.length, next.length)) * 100
}

export const DISJOINT_OVERLAP_THRESHOLD = 50
export const DISJOINT_MIN_SET_SIZE = 4

/**
 * Append-only record of one schedule generation plus alert-only metering.
 * Must run INSIDE the schedule-creation transaction: a failed log write fails
 * the generation. Never throws for alert conditions — alerts do not block.
 */
export async function recordGeneration(
  client: PoolClient,
  year: number,
  month: number,
  doctorIds: number[],
): Promise<void> {
  for (const doctorId of doctorIds) {
    await client.query(
      'INSERT INTO schedule_generation_log (doctor_id, year, month) VALUES ($1, $2, $3)',
      [doctorId, year, month],
    )
  }

  // Rule 1: rolling allowance over distinct doctors within the window.
  const rolling = await client.query<{ n: number }>(
    `SELECT COUNT(DISTINCT doctor_id)::int AS n FROM schedule_generation_log
     WHERE created_at >= NOW() - ($1 || ' days')::interval`,
    [license.rollingWindowDays],
  )
  const distinct = rolling.rows[0]?.n ?? 0
  if (distinct > license.doctorAllowance) {
    await client.query(
      `INSERT INTO operator_alerts (type, detail)
       SELECT 'allowance_exceeded',
              jsonb_build_object('distinctDoctors', $1::int, 'allowance', $2::int, 'windowDays', $3::int)
       WHERE NOT EXISTS (
         SELECT 1 FROM operator_alerts
         WHERE type = 'allowance_exceeded' AND resolved_at IS NULL
       )`,
      [distinct, license.doctorAllowance, license.rollingWindowDays],
    )
  }

  // Rule 2: disjoint regeneration vs the most recent prior generation of this month.
  // Rows written by this transaction share NOW(), so `created_at < NOW()` cleanly
  // selects only prior generations. The batch timestamp travels as text because
  // node-postgres truncates timestamptz microseconds when parsing to a JS Date,
  // which would break the exact equality match below.
  const prevBatch = await client.query<{ created_at: string | null }>(
    `SELECT MAX(created_at)::text AS created_at FROM schedule_generation_log
     WHERE year = $1 AND month = $2 AND created_at < NOW()`,
    [year, month],
  )
  const prevTime = prevBatch.rows[0]?.created_at
  if (prevTime) {
    const prevDocs = await client.query<{ doctor_id: number }>(
      `SELECT DISTINCT doctor_id FROM schedule_generation_log
       WHERE year = $1 AND month = $2 AND created_at = $3::timestamptz`,
      [year, month, prevTime],
    )
    const prevIds = prevDocs.rows.map((r) => r.doctor_id)
    const overlap = overlapPercent(prevIds, doctorIds)
    if (
      prevIds.length >= DISJOINT_MIN_SET_SIZE &&
      doctorIds.length >= DISJOINT_MIN_SET_SIZE &&
      overlap < DISJOINT_OVERLAP_THRESHOLD
    ) {
      const names = await client.query<{ id: number; name: string }>(
        `SELECT DISTINCT d.id, u.first_name || ' ' || u.last_name AS name
         FROM doctors d JOIN users u ON u.id = d.user_id
         WHERE d.id = ANY($1) OR d.id = ANY($2)`,
        [prevIds, doctorIds],
      )
      const nameOf = new Map(names.rows.map((r) => [r.id, r.name]))
      await client.query(
        `INSERT INTO operator_alerts (type, detail)
         SELECT 'disjoint_regeneration', jsonb_build_object(
           'year', $1::int, 'month', $2::int,
           'previousGeneratedAt', $3::text, 'previousDoctors', $4::jsonb,
           'currentDoctors', $5::jsonb, 'overlapPercent', $6::int
         )
         WHERE NOT EXISTS (
           SELECT 1 FROM operator_alerts
           WHERE type = 'disjoint_regeneration' AND resolved_at IS NULL
             AND detail->>'year' = $7 AND detail->>'month' = $8
         )`,
        [
          year,
          month,
          prevTime,
          JSON.stringify(prevIds.map((id) => ({ id, name: nameOf.get(id) ?? String(id) }))),
          JSON.stringify(doctorIds.map((id) => ({ id, name: nameOf.get(id) ?? String(id) }))),
          Math.round(overlap),
          String(year),
          String(month),
        ],
      )
    }
  }
}
