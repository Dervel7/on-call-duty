import bcrypt from 'bcrypt'
import { query, withTransaction } from '../db/client'
import { HttpError } from '../lib/http-error'
import type {
  AuthUser,
  CreateUserRequest,
  Role,
  UpdateUserRequest,
  User,
} from '@oncall/shared'
import { recordActivity } from './activity.service'

type Actor = Pick<AuthUser, 'id' | 'role'>

interface UserRow {
  id: number
  email: string
  username: string
  password_hash: string
  role: Role
  first_name: string
  last_name: string
  is_active: boolean
  created_at: Date
}

const COLUMNS = `id, email, username, password_hash, role, first_name, last_name, is_active, created_at`

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
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

export async function list(actor?: Actor): Promise<User[]> {
  if (actor && actor.role !== 'superadmin') {
    const filtered = await query<UserRow>(
      `SELECT ${COLUMNS} FROM users WHERE role <> $1 ORDER BY created_at`,
      ['superadmin'],
    )
    return filtered.rows.map(toUser)
  }
  const res = await query<UserRow>(`SELECT ${COLUMNS} FROM users ORDER BY created_at`, [])
  return res.rows.map(toUser)
}

export async function getById(id: number, actor?: Actor): Promise<User> {
  const res = await query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id])
  const row = oneRow(res.rows)
  if (!row) throw new HttpError(404, 'User not found')
  if (row.role === 'superadmin' && actor && actor.role !== 'superadmin') {
    throw new HttpError(404, 'User not found')
  }
  return toUser(row)
}

export async function create(input: CreateUserRequest, actor: Actor): Promise<User> {
  if (input.role === 'superadmin' && actor.role !== 'superadmin') {
    throw new HttpError(403, 'Only a superadmin can create superadmin accounts')
  }
  const existingEmail = await query(`SELECT id FROM users WHERE email = $1`, [input.email])
  if (existingEmail.rows.length > 0) throw new HttpError(409, 'Email already in use')
  const existingUsername = await query(`SELECT id FROM users WHERE username = $1`, [input.username])
  if (existingUsername.rows.length > 0) throw new HttpError(409, 'Username already in use')
  const passwordHash = await bcrypt.hash(input.password, 12)
  const row = await withTransaction(async (client) => {
    const res = await client.query<UserRow>(
      `INSERT INTO users (email, username, password_hash, role, first_name, last_name)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
      [input.email, input.username, passwordHash, input.role, input.firstName, input.lastName],
    )
    const inserted = oneRow(res.rows)
    if (!inserted) throw new HttpError(500, 'Failed to create user')
    await recordActivity(client, {
      userId: actor.id,
      action: 'user.created',
      entityType: 'user',
      entityId: inserted.id,
      detail: {
        email: input.email,
        username: input.username,
        role: input.role,
        firstName: input.firstName,
        lastName: input.lastName,
      },
    })
    return inserted
  })
  return toUser(row)
}

export async function update(id: number, input: UpdateUserRequest, actor: Actor): Promise<User> {
  const existing = await getById(id)
  if (actor.role !== 'superadmin') {
    if (existing.role === 'superadmin' || input.role === 'superadmin') {
      throw new HttpError(403, 'Only a superadmin can manage superadmin accounts')
    }
  }
  const sets: string[] = []
  const params: unknown[] = []
  const map: Array<[string, unknown]> = [
    ['email', input.email],
    ['username', input.username],
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
  if (input.role !== undefined && input.role !== existing.role) {
    before.role = existing.role
    after.role = input.role
  }
  if (input.firstName !== undefined && input.firstName !== existing.firstName) {
    before.firstName = existing.firstName
    after.firstName = input.firstName
  }
  if (input.lastName !== undefined && input.lastName !== existing.lastName) {
    before.lastName = existing.lastName
    after.lastName = input.lastName
  }
  const isActiveChanged = input.isActive !== undefined && input.isActive !== existing.isActive
  if (isActiveChanged) {
    before.isActive = existing.isActive
    after.isActive = input.isActive
  }
  const action = isActiveChanged
    ? input.isActive
      ? 'user.reactivated'
      : 'user.deactivated'
    : 'user.updated'
  const row = await withTransaction(async (client) => {
    const res = await client.query<UserRow>(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
      params,
    )
    const updated = oneRow(res.rows)
    if (!updated) throw new HttpError(404, 'User not found')
    if (Object.keys(before).length > 0) {
      await recordActivity(client, {
        userId: actor.id,
        action,
        entityType: 'user',
        entityId: id,
        detail: { before, after },
      })
    }
    return updated
  })
  return toUser(row)
}

export async function remove(id: number, actor: Actor): Promise<void> {
  const existing = await getById(id)
  if (existing.role === 'superadmin' && actor.role !== 'superadmin') {
    throw new HttpError(403, 'Only a superadmin can manage superadmin accounts')
  }
  await withTransaction(async (client) => {
    const res = await client.query('DELETE FROM users WHERE id = $1 RETURNING id', [id])
    if (res.rows.length === 0) throw new HttpError(404, 'User not found')
    await recordActivity(client, {
      userId: actor.id,
      action: 'user.deleted',
      entityType: 'user',
      entityId: id,
      detail: { email: existing.email, username: existing.username },
    })
  })
}
