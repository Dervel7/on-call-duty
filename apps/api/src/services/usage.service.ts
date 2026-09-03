import type { PoolClient } from 'pg'
import type {
  GeneratePressCounts,
  GenerationEvent,
  OperatorAlert,
  UsageSummary,
} from '@oncall/shared'
import { license } from '../config/license'
import { query } from '../db/client'
import { HttpError } from '../lib/http-error'

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

interface AlertRow {
  id: number
  type: 'allowance_exceeded' | 'disjoint_regeneration'
  detail: Record<string, unknown>
  created_at: Date
  resolved_at: Date | null
}

function toAlert(row: AlertRow): OperatorAlert {
  return {
    id: row.id,
    type: row.type,
    detail: row.detail,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
  }
}

export async function summary(): Promise<UsageSummary> {
  const res = await query<{ n: number }>(
    `SELECT COUNT(DISTINCT doctor_id)::int AS n FROM schedule_generation_log
     WHERE created_at >= NOW() - ($1 || ' days')::interval`,
    [license.rollingWindowDays],
  )
  const open = await query<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM operator_alerts WHERE resolved_at IS NULL',
  )
  return {
    license: {
      licensee: license.licensee,
      doctorAllowance: license.doctorAllowance,
      rollingWindowDays: license.rollingWindowDays,
      expiresAt: license.expiresAt,
    },
    rollingDistinctDoctors: res.rows[0]?.n ?? 0,
    openAlerts: open.rows[0]?.n ?? 0,
  }
}

export async function generations(): Promise<GenerationEvent[]> {
  // Batch timestamps travel as text for the same reason as in recordGeneration:
  // node-postgres truncates timestamptz microseconds when parsing to a JS Date,
  // which would break the exact equality match on each batch.
  const batches = await query<{ year: number; month: number; created_at: string }>(
    `SELECT year, month, created_at::text AS created_at FROM schedule_generation_log
     GROUP BY year, month, created_at ORDER BY created_at DESC`,
  )
  const events: GenerationEvent[] = []
  for (const b of batches.rows) {
    const docs = await query<{ doctor_id: number; name: string }>(
      `SELECT DISTINCT l.doctor_id, u.first_name || ' ' || u.last_name AS name
       FROM schedule_generation_log l
       JOIN doctors d ON d.id = l.doctor_id JOIN users u ON u.id = d.user_id
       WHERE l.year = $1 AND l.month = $2 AND l.created_at = $3::timestamptz`,
      [b.year, b.month, b.created_at],
    )
    const ids = docs.rows.map((r) => r.doctor_id)
    const prev = batches.rows.find(
      (o) =>
        o.year === b.year &&
        o.month === b.month &&
        o.created_at < b.created_at,
    )
    let overlap: number | null = null
    if (prev) {
      const prevDocs = await query<{ doctor_id: number }>(
        `SELECT DISTINCT doctor_id FROM schedule_generation_log
         WHERE year = $1 AND month = $2 AND created_at = $3::timestamptz`,
        [prev.year, prev.month, prev.created_at],
      )
      overlap = Math.round(
        overlapPercent(
          prevDocs.rows.map((r) => r.doctor_id),
          ids,
        ),
      )
    }
    events.push({
      year: b.year,
      month: b.month,
      generatedAt: new Date(b.created_at).toISOString(),
      doctorIds: ids,
      doctorNames: docs.rows.map((r) => r.name),
      overlapPercent: overlap,
    })
  }
  return events
}

export async function listAlerts(): Promise<OperatorAlert[]> {
  const res = await query<AlertRow>(
    `SELECT id, type, detail, created_at, resolved_at FROM operator_alerts
     ORDER BY resolved_at IS NOT NULL, created_at DESC`,
  )
  return res.rows.map(toAlert)
}

export async function resolveAlert(id: number): Promise<OperatorAlert> {
  const res = await query<AlertRow>(
    `UPDATE operator_alerts SET resolved_at = NOW()
     WHERE id = $1 AND resolved_at IS NULL
     RETURNING id, type, detail, created_at, resolved_at`,
    [id],
  )
  const row = res.rows[0]
  if (!row) {
    const found = await query('SELECT 1 FROM operator_alerts WHERE id = $1', [id])
    if (found.rows.length === 0) throw new HttpError(404, 'Alert not found')
    throw new HttpError(409, 'Alert already resolved')
  }
  return toAlert(row)
}

export async function recordGeneratePress(userId: number): Promise<void> {
  await query(
    `INSERT INTO generate_press_counters (user_id, press_date, count)
     VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (user_id, press_date)
     DO UPDATE SET count = generate_press_counters.count + 1`,
    [userId],
  )
}

interface PressCountRow {
  user_id: number
  username: string
  first_name: string
  last_name: string
  presses: number
}

export async function generatePressCounts(): Promise<GeneratePressCounts> {
  const res = await query<PressCountRow>(
    `SELECT u.id AS user_id, u.username, u.first_name, u.last_name,
            COALESCE(SUM(g.count), 0)::int AS presses
     FROM generate_press_counters g JOIN users u ON u.id = g.user_id
     GROUP BY u.id, u.username, u.first_name, u.last_name
     ORDER BY presses DESC, u.id`,
  )
  const byUser = res.rows.map((r) => ({
    userId: r.user_id,
    username: r.username,
    firstName: r.first_name,
    lastName: r.last_name,
    presses: r.presses,
  }))
  return { total: byUser.reduce((sum, u) => sum + u.presses, 0), byUser }
}
