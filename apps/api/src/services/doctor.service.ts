import bcrypt from 'bcrypt'
import { query, withTransaction } from '../db/client'
import { HttpError } from '../lib/http-error'
import type {
  AuthUser,
  CreateDoctorRequest,
  Doctor,
  UpdateDoctorRequest,
} from '@oncall/shared'
import { recordActivity } from './activity.service'

type Actor = Pick<AuthUser, 'id' | 'role'>

interface DoctorRow {
  id: number
  user_id: number
  email: string
  username: string
  first_name: string
  last_name: string
  is_active: boolean
  max_monthly_duties: number
  created_at: Date
  updated_at: Date
}

const SELECT = `SELECT d.id, d.user_id, d.max_monthly_duties, d.created_at, d.updated_at,
  u.email, u.username, u.first_name, u.last_name, u.is_active
  FROM doctors d JOIN users u ON u.id = d.user_id`

function toDoctor(row: DoctorRow): Doctor {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    username: row.username,
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

export async function create(input: CreateDoctorRequest, actor: Actor): Promise<Doctor> {
  const doctorId = await withTransaction(async (client) => {
    const dupEmail = await client.query('SELECT id FROM users WHERE email = $1', [input.email])
    if (dupEmail.rows.length > 0) throw new HttpError(409, 'Email already in use')
    const dupUser = await client.query('SELECT id FROM users WHERE username = $1', [input.username])
    if (dupUser.rows.length > 0) throw new HttpError(409, 'Username already in use')
    const passwordHash = await bcrypt.hash(input.password, 12)
    const ins = await client.query(
      `INSERT INTO users (email, username, password_hash, role, first_name, last_name)
       VALUES ($1, $2, $3, 'doctor', $4, $5) RETURNING id`,
      [input.email, input.username, passwordHash, input.firstName, input.lastName],
    )
    const userId = ins.rows[0]?.id
    if (userId === undefined) throw new HttpError(500, 'Failed to create user')
    const docIns = await client.query<{ id: number }>(
      'INSERT INTO doctors (user_id, max_monthly_duties) VALUES ($1, $2) RETURNING id',
      [userId, input.maxMonthlyDuties ?? 7],
    )
    const docId = docIns.rows[0]?.id
    if (docId === undefined) throw new HttpError(500, 'Failed to create doctor')
    await recordActivity(client, {
      userId: actor.id,
      action: 'doctor.created',
      entityType: 'doctor',
      entityId: docId,
      detail: {
        email: input.email,
        username: input.username,
        firstName: input.firstName,
        lastName: input.lastName,
        maxMonthlyDuties: input.maxMonthlyDuties ?? 7,
      },
    })
    return docId
  })
  return getById(doctorId)
}

export async function update(id: number, input: UpdateDoctorRequest, actor: Actor): Promise<Doctor> {
  const existing = await getById(id)
  const userId = existing.userId

  await withTransaction(async (client) => {
    const sets: string[] = []
    const params: unknown[] = []
    const map: Array<[string, unknown]> = [
      ['email', input.email],
      ['username', input.username],
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
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    if (input.email !== undefined && input.email !== existing.email) {
      before.email = existing.email
      after.email = input.email
    }
    if (input.username !== undefined && input.username !== existing.username) {
      before.username = existing.username
      after.username = input.username
    }
    if (input.firstName !== undefined && input.firstName !== existing.firstName) {
      before.firstName = existing.firstName
      after.firstName = input.firstName
    }
    if (input.lastName !== undefined && input.lastName !== existing.lastName) {
      before.lastName = existing.lastName
      after.lastName = input.lastName
    }
    if (input.isActive !== undefined && input.isActive !== existing.isActive) {
      before.isActive = existing.isActive
      after.isActive = input.isActive
    }
    if (input.maxMonthlyDuties !== undefined && input.maxMonthlyDuties !== existing.maxMonthlyDuties) {
      before.maxMonthlyDuties = existing.maxMonthlyDuties
      after.maxMonthlyDuties = input.maxMonthlyDuties
    }
    if (Object.keys(before).length > 0) {
      await recordActivity(client, {
        userId: actor.id,
        action: 'doctor.updated',
        entityType: 'doctor',
        entityId: id,
        detail: { before, after },
      })
    }
  })
  return getById(id)
}

export async function deactivate(id: number, actor: Actor): Promise<void> {
  const existing = await getById(id)
  await withTransaction(async (client) => {
    await client.query('UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [
      existing.userId,
    ])
    await recordActivity(client, {
      userId: actor.id,
      action: 'doctor.deactivated',
      entityType: 'doctor',
      entityId: id,
      detail: { email: existing.email },
    })
  })
}
