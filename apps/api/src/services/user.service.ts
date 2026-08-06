import bcrypt from 'bcrypt'
import { query } from '../db/client'
import { HttpError } from '../lib/http-error'
import type { CreateUserRequest, UpdateUserRequest, User } from '@oncall/shared'

interface UserRow {
  id: number
  email: string
  password_hash: string
  role: 'administrator' | 'doctor'
  first_name: string
  last_name: string
  is_active: boolean
  created_at: Date
}

const COLUMNS = `id, email, password_hash, role, first_name, last_name, is_active, created_at`

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    firstName: row.first_name,
    lastName: row.last_name,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
  }
}

function oneRow(rows: UserRow[]): UserRow | undefined {
  return rows[0]
}

export async function list(): Promise<User[]> {
  const res = await query<UserRow>(`SELECT ${COLUMNS} FROM users ORDER BY created_at`, [])
  return res.rows.map(toUser)
}

export async function getById(id: number): Promise<User> {
  const res = await query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id])
  const row = oneRow(res.rows)
  if (!row) throw new HttpError(404, 'User not found')
  return toUser(row)
}

export async function create(input: CreateUserRequest): Promise<User> {
  const existing = await query(`SELECT id FROM users WHERE email = $1`, [input.email])
  if (existing.rows.length > 0) throw new HttpError(409, 'Email already in use')
  const passwordHash = await bcrypt.hash(input.password, 12)
  const res = await query<UserRow>(
    `INSERT INTO users (email, password_hash, role, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
    [input.email, passwordHash, input.role, input.firstName, input.lastName],
  )
  const row = oneRow(res.rows)
  if (!row) throw new HttpError(500, 'Failed to create user')
  return toUser(row)
}

export async function update(id: number, input: UpdateUserRequest): Promise<User> {
  const sets: string[] = []
  const params: unknown[] = []
  const map: Array<[string, unknown]> = [
    ['email', input.email],
    ['role', input.role],
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
  if (sets.length === 0) return getById(id)
  params.push(new Date())
  sets.push(`updated_at = $${params.length}`)
  params.push(id)
  const res = await query<UserRow>(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
    params,
  )
  const row = oneRow(res.rows)
  if (!row) throw new HttpError(404, 'User not found')
  return toUser(row)
}

export async function remove(id: number): Promise<void> {
  const res = await query(`DELETE FROM users WHERE id = $1 RETURNING id`, [id])
  if (res.rows.length === 0) throw new HttpError(404, 'User not found')
}
