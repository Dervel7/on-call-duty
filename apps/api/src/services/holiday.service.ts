import type {
  AuthUser,
  CreateHolidayRequest,
  Holiday,
  HolidayQuery,
  UpdateHolidayRequest,
} from '@oncall/shared'
import type { PoolClient } from 'pg'
import { query, withTransaction } from '../db/client'
import { HttpError } from '../lib/http-error'
import { recordActivity } from './activity.service'

type Actor = Pick<AuthUser, 'id' | 'role'>

interface HolidayRow {
  id: number
  name: string
  date: string
  created_at: Date
  updated_at: Date
}

const SELECT = `SELECT id, name, date, created_at, updated_at FROM holidays`

function toHoliday(row: HolidayRow): Holiday {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

async function getById(id: number): Promise<Holiday> {
  const res = await query<HolidayRow>(`${SELECT} WHERE id = $1`, [id])
  const row = res.rows[0]
  if (!row) throw new HttpError(404, 'Holiday not found')
  return toHoliday(row)
}

/**
 * duties.is_holiday is denormalized at duty-write time; keep it consistent
 * when holidays change so stats/reports do not contradict the holidays table.
 */
async function resyncHolidayFlags(client: PoolClient, dates: string[]): Promise<void> {
  if (dates.length === 0) return
  await client.query(
    `UPDATE duties SET is_holiday = EXISTS (SELECT 1 FROM holidays h WHERE h.date = duties.duty_date)
     WHERE duty_date = ANY($1::date[])`,
    [dates],
  )
}

export async function list(filters: HolidayQuery = {}): Promise<Holiday[]> {
  const where: string[] = []
  const params: unknown[] = []
  if (filters.from !== undefined) {
    params.push(filters.from)
    where.push(`date >= $${params.length}`)
  }
  if (filters.to !== undefined) {
    params.push(filters.to)
    where.push(`date <= $${params.length}`)
  }
  const sql =
    where.length > 0
      ? `${SELECT} WHERE ${where.join(' AND ')} ORDER BY date`
      : `${SELECT} ORDER BY date`
  const res = await query<HolidayRow>(sql, params)
  return res.rows.map(toHoliday)
}

export async function create(input: CreateHolidayRequest, actor: Actor): Promise<Holiday> {
  const dup = await query('SELECT id FROM holidays WHERE date = $1', [input.date])
  if (dup.rows.length > 0) throw new HttpError(409, 'Holiday already exists on this date')
  const id = await withTransaction(async (client) => {
    const ins = await client.query<{ id: number }>(
      'INSERT INTO holidays (name, date) VALUES ($1, $2) RETURNING id',
      [input.name, input.date],
    )
    const newId = ins.rows[0]?.id
    if (newId === undefined) throw new HttpError(500, 'Failed to create holiday')
    await resyncHolidayFlags(client, [input.date])
    await recordActivity(client, {
      userId: actor.id,
      action: 'holiday.created',
      entityType: 'holiday',
      entityId: newId,
      detail: { name: input.name, date: input.date },
    })
    return newId
  })
  return getById(id)
}

export async function update(
  id: number,
  input: UpdateHolidayRequest,
  actor: Actor,
): Promise<Holiday> {
  const existing = await query<HolidayRow>(`${SELECT} WHERE id = $1`, [id])
  if (existing.rows.length === 0) throw new HttpError(404, 'Holiday not found')
  if (input.date !== undefined) {
    const dup = await query('SELECT id FROM holidays WHERE date = $1 AND id <> $2', [
      input.date,
      id,
    ])
    if (dup.rows.length > 0) throw new HttpError(409, 'Holiday already exists on this date')
  }
  const sets: string[] = []
  const params: unknown[] = []
  const map: Array<[string, unknown]> = [
    ['name', input.name],
    ['date', input.date],
  ]
  for (const [col, value] of map) {
    if (value !== undefined) {
      params.push(value)
      sets.push(`${col} = $${params.length}`)
    }
  }
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  if (input.name !== undefined && input.name !== existing.rows[0]!.name) {
    before.name = existing.rows[0]!.name
    after.name = input.name
  }
  if (input.date !== undefined && input.date !== existing.rows[0]!.date) {
    before.date = existing.rows[0]!.date
    after.date = input.date
  }
  if (sets.length > 0) {
    params.push(id)
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE holidays SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
        params,
      )
      if (before.date !== undefined) {
        await resyncHolidayFlags(client, [String(before.date), String(after.date)])
      }
      if (Object.keys(before).length > 0) {
        await recordActivity(client, {
          userId: actor.id,
          action: 'holiday.updated',
          entityType: 'holiday',
          entityId: id,
          detail: { before, after },
        })
      }
    })
  }
  return getById(id)
}

export async function remove(id: number, actor: Actor): Promise<void> {
  const existing = await query<HolidayRow>(`${SELECT} WHERE id = $1`, [id])
  if (existing.rows.length === 0) throw new HttpError(404, 'Holiday not found')
  await withTransaction(async (client) => {
    await client.query('DELETE FROM holidays WHERE id = $1', [id])
    await resyncHolidayFlags(client, [existing.rows[0]!.date])
    await recordActivity(client, {
      userId: actor.id,
      action: 'holiday.deleted',
      entityType: 'holiday',
      entityId: id,
      detail: { name: existing.rows[0]!.name, date: existing.rows[0]!.date },
    })
  })
}
