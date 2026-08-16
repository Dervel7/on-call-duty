import type { PoolClient } from 'pg'
import type {
  ActivityAction,
  ActivityLogEntry,
  ActivityQuery,
  PaginatedActivity,
  Role,
} from '@oncall/shared'
import { query, withTransaction } from '../db/client'

export interface ActivityInput {
  userId: number
  action: ActivityAction
  entityType: string
  entityId: number | null
  detail?: Record<string, unknown>
}

/** Must run inside the caller's transaction: a failed audit write fails the business change. */
export async function recordActivity(client: PoolClient, input: ActivityInput): Promise<void> {
  await client.query(
    'INSERT INTO activity_log (user_id, action, entity_type, entity_id, detail) VALUES ($1, $2, $3, $4, $5)',
    [input.userId, input.action, input.entityType, input.entityId, JSON.stringify(input.detail ?? {})],
  )
}

/** Wrapper for events that are not part of a business transaction (auth events). */
export async function logActivity(input: ActivityInput): Promise<void> {
  await withTransaction((client) => recordActivity(client, input))
}

interface ActivityRow {
  id: number
  action: ActivityAction
  entity_type: string
  entity_id: number | null
  detail: Record<string, unknown> | null
  created_at: Date
  actor_id: number | null
  actor_username: string | null
  actor_role: Role | null
  actor_first_name: string | null
  actor_last_name: string | null
}

const SELECT = `SELECT a.id, a.action, a.entity_type, a.entity_id, a.detail, a.created_at,
  u.id AS actor_id, u.username AS actor_username, u.role AS actor_role,
  u.first_name AS actor_first_name, u.last_name AS actor_last_name
  FROM activity_log a LEFT JOIN users u ON u.id = a.user_id`

function toEntry(row: ActivityRow): ActivityLogEntry {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    detail: row.detail ?? {},
    createdAt: row.created_at.toISOString(),
    actor:
      row.actor_id === null
        ? null
        : {
            id: row.actor_id,
            username: row.actor_username ?? '',
            role: row.actor_role ?? 'doctor',
            firstName: row.actor_first_name ?? '',
            lastName: row.actor_last_name ?? '',
          },
  }
}

export async function list(filters: ActivityQuery): Promise<PaginatedActivity> {
  const page = filters.page ?? 1
  const limit = filters.limit ?? 50
  const where: string[] = []
  const params: unknown[] = []
  if (filters.action !== undefined) {
    params.push(filters.action)
    where.push(`a.action = $${params.length}`)
  }
  if (filters.userId !== undefined) {
    params.push(filters.userId)
    where.push(`a.user_id = $${params.length}`)
  }
  if (filters.from !== undefined) {
    params.push(filters.from)
    where.push(`a.created_at >= $${params.length}::date`)
  }
  if (filters.to !== undefined) {
    params.push(filters.to)
    where.push(`a.created_at < ($${params.length}::date + 1)`)
  }
  const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''

  const count = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM activity_log a${whereSql}`,
    params,
  )
  const total = count.rows[0]?.n ?? 0

  params.push(limit)
  const limitRef = `$${params.length}`
  params.push((page - 1) * limit)
  const offsetRef = `$${params.length}`
  const res = await query<ActivityRow>(
    `${SELECT}${whereSql} ORDER BY a.created_at DESC, a.id DESC LIMIT ${limitRef} OFFSET ${offsetRef}`,
    params,
  )
  return { items: res.rows.map(toEntry), total, page, limit }
}
