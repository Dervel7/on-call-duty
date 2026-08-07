import type {
  CreateHolidayRequest,
  Holiday,
  HolidayQuery,
  UpdateHolidayRequest,
} from '@oncall/shared'
import { query } from '../db/client'
import { HttpError } from '../lib/http-error'

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

export async function create(input: CreateHolidayRequest): Promise<Holiday> {
  const dup = await query('SELECT id FROM holidays WHERE date = $1', [input.date])
  if (dup.rows.length > 0) throw new HttpError(409, 'Holiday already exists on this date')
  const ins = await query<{ id: number }>(
    'INSERT INTO holidays (name, date) VALUES ($1, $2) RETURNING id',
    [input.name, input.date],
  )
  const id = ins.rows[0]?.id
  if (id === undefined) throw new HttpError(500, 'Failed to create holiday')
  return getById(id)
}

export async function update(id: number, input: UpdateHolidayRequest): Promise<Holiday> {
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
  if (sets.length > 0) {
    params.push(id)
    await query(
      `UPDATE holidays SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
      params,
    )
  }
  return getById(id)
}

export async function remove(id: number): Promise<void> {
  const existing = await query('SELECT id FROM holidays WHERE id = $1', [id])
  if (existing.rows.length === 0) throw new HttpError(404, 'Holiday not found')
  await query('DELETE FROM holidays WHERE id = $1', [id])
}
