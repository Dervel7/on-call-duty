import bcrypt from 'bcrypt'
import { query, withTransaction } from '../db/client'
import { HttpError } from '../lib/http-error'
import type { CreateDoctorRequest, Doctor, UpdateDoctorRequest } from '@oncall/shared'

interface DoctorRow {
  id: number
  user_id: number
  email: string
  first_name: string
  last_name: string
  is_active: boolean
  max_monthly_duties: number
  created_at: Date
  updated_at: Date
}

const SELECT = `SELECT d.id, d.user_id, d.max_monthly_duties, d.created_at, d.updated_at,
  u.email, u.first_name, u.last_name, u.is_active
  FROM doctors d JOIN users u ON u.id = d.user_id`

function toDoctor(row: DoctorRow): Doctor {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    isActive: row.is_active,
    maxMonthlyDuties: row.max_monthly_duties,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

export async function list(): Promise<Doctor[]> {
  const res = await query<DoctorRow>(`${SELECT} ORDER BY u.last_name, u.first_name`, [])
  return res.rows.map(toDoctor)
}

export async function getById(id: number): Promise<Doctor> {
  const res = await query<DoctorRow>(`${SELECT} WHERE d.id = $1`, [id])
  const row = res.rows[0]
  if (!row) throw new HttpError(404, 'Doctor not found')
  return toDoctor(row)
}

export async function getByUserId(userId: number): Promise<Doctor> {
  const res = await query<DoctorRow>(`${SELECT} WHERE d.user_id = $1`, [userId])
  const row = res.rows[0]
  if (!row) throw new HttpError(404, 'Doctor not found')
  return toDoctor(row)
}

export async function create(input: CreateDoctorRequest): Promise<Doctor> {
  const userId = await withTransaction(async (client) => {
    const dup = await client.query('SELECT id FROM users WHERE email = $1', [input.email])
    if (dup.rows.length > 0) throw new HttpError(409, 'Email already in use')
    const passwordHash = await bcrypt.hash(input.password, 12)
    const ins = await client.query(
      `INSERT INTO users (email, password_hash, role, first_name, last_name)
       VALUES ($1, $2, 'doctor', $3, $4) RETURNING id`,
      [input.email, passwordHash, input.firstName, input.lastName],
    )
    const id = ins.rows[0]?.id
    if (id === undefined) throw new HttpError(500, 'Failed to create user')
    await client.query(
      'INSERT INTO doctors (user_id, max_monthly_duties) VALUES ($1, $2)',
      [id, input.maxMonthlyDuties ?? 7],
    )
    return id
  })
  return getByUserId(userId)
}

export async function update(id: number, input: UpdateDoctorRequest): Promise<Doctor> {
  const existing = await query<{ user_id: number }>(
    'SELECT user_id FROM doctors WHERE id = $1',
    [id],
  )
  const row = existing.rows[0]
  if (!row) throw new HttpError(404, 'Doctor not found')
  const userId = row.user_id

  await withTransaction(async (client) => {
    const sets: string[] = []
    const params: unknown[] = []
    const map: Array<[string, unknown]> = [
      ['email', input.email],
      ['first_name', input.firstName],
      ['last_name', input.lastName],
      ['is_active', input.isActive],
    ]
    for (const [col, value] of map) {
      if (value !== undefined) {
        params.push(value)
        sets.push(`${col} = $${params.length}`)
      }
    }
    if (sets.length > 0) {
      params.push(new Date())
      sets.push(`updated_at = $${params.length}`)
      params.push(userId)
      await client.query(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params,
      )
    }
    if (input.maxMonthlyDuties !== undefined) {
      await client.query(
        'UPDATE doctors SET max_monthly_duties = $1, updated_at = NOW() WHERE id = $2',
        [input.maxMonthlyDuties, id],
      )
    }
  })
  return getById(id)
}

export async function remove(id: number): Promise<void> {
  const existing = await query<{ user_id: number }>(
    'SELECT user_id FROM doctors WHERE id = $1',
    [id],
  )
  const row = existing.rows[0]
  if (!row) throw new HttpError(404, 'Doctor not found')
  const duties = await query('SELECT 1 FROM duties WHERE doctor_id = $1 LIMIT 1', [id])
  if (duties.rows.length > 0)
    throw new HttpError(
      409,
      'Cannot delete a doctor with scheduled duties; set them inactive instead',
    )
  await query('DELETE FROM users WHERE id = $1', [row.user_id])
}
