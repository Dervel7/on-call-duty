import bcrypt from 'bcrypt'
import { query, withTransaction } from '../db/client'
import { HttpError } from '../lib/http-error'
import type { ClinicScope } from '../lib/scope'
import type {
  AuthUser,
  CreateUserRequest,
  Role,
  UpdateUserRequest,
  User,
} from '@oncall/shared'
import { recordActivity } from './activity.service'
import * as tokenService from './token.service'

type Actor = Pick<AuthUser, 'id' | 'role' | 'clinicId'>

interface UserRow {
  id: number
  email: string
  username: string
  password_hash: string
  role: Role
  first_name: string
  last_name: string
  is_active: boolean
  dark_mode: boolean
  clinic_id: number | null
  clinic_name: string | null
  created_at: Date
}

// INSERT/UPDATE RETURNING cannot join, so every read path goes through this.
const COLUMNS = `u.id, u.email, u.username, u.password_hash, u.role, u.first_name, u.last_name,
  u.is_active, u.dark_mode, u.clinic_id, c.name AS clinic_name, u.created_at`
const FROM_USERS = `users u LEFT JOIN clinics c ON c.id = u.clinic_id`

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    role: row.role,
    firstName: row.first_name,
    lastName: row.last_name,
    darkMode: row.dark_mode,
    clinicId: row.clinic_id,
    clinicName: row.clinic_name,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
  }
}

function oneRow(rows: UserRow[]): UserRow | undefined {
  return rows[0]
}

/** Minimal client shape so transaction clients can feed row reads. */
interface RowQueryer {
  query(text: string, params?: unknown[]): Promise<{ rows: UserRow[] }>
}

async function selectUserById(client: RowQueryer, id: number): Promise<UserRow> {
  const res = await client.query(
    `SELECT ${COLUMNS} FROM ${FROM_USERS} WHERE u.id = $1 AND u.is_deleted = FALSE`,
    [id],
  )
  const row = oneRow(res.rows)
  if (!row) throw new HttpError(404, 'User not found')
  return row
}

function assertRowVisible(row: UserRow, actor: Actor): void {
  if (
    (actor.role === 'administrator' || actor.role === 'doctor') &&
    row.clinic_id !== actor.clinicId
  ) {
    throw new HttpError(404, 'User not found')
  }
  if (actor.role !== 'superadmin' && (row.role === 'superadmin' || row.role === 'manager')) {
    throw new HttpError(404, 'User not found')
  }
}

/** Unknown or inactive target clinic → 404/403 (creation into it is blocked, D10). */
async function assertClinicUsable(clinicId: number): Promise<void> {
  const res = await query<{ is_active: boolean }>(`SELECT is_active FROM clinics WHERE id = $1`, [
    clinicId,
  ])
  const clinic = res.rows[0]
  if (!clinic) throw new HttpError(404, 'Clinic not found')
  if (!clinic.is_active) throw new HttpError(403, 'Clinic is deactivated')
}

export async function list(actor: Actor, scope: ClinicScope): Promise<User[]> {
  // One rule for all roles: a clinic's members. Hospital-level accounts are
  // invisible to anyone but a superadmin (they carry no clinic anyway).
  const hideHospitalRoles = actor.role !== 'superadmin'
  const sql = `SELECT ${COLUMNS} FROM ${FROM_USERS}
    WHERE u.is_deleted = FALSE AND u.clinic_id = $1
      ${hideHospitalRoles ? `AND u.role NOT IN ('superadmin', 'manager')` : ''}
    ORDER BY u.created_at`
  const res = await query<UserRow>(sql, [scope.clinicId])
  return res.rows.map(toUser)
}

export async function getById(id: number, actor: Actor): Promise<User> {
  const res = await query<UserRow>(
    `SELECT ${COLUMNS} FROM ${FROM_USERS} WHERE u.id = $1 AND u.is_deleted = FALSE`,
    [id],
  )
  const row = oneRow(res.rows)
  if (!row) throw new HttpError(404, 'User not found')
  assertRowVisible(row, actor)
  return toUser(row)
}

/** Resolves the target clinic of a new account per §2.5 POST /users rules. */
function resolveCreateClinic(input: CreateUserRequest, actor: Actor): number | null {
  if (actor.role === 'administrator') {
    if (input.role === 'superadmin' || input.role === 'manager') {
      throw new HttpError(403, 'Administrators can only create clinic accounts')
    }
    if (actor.clinicId === null) throw new HttpError(403, 'Forbidden')
    return actor.clinicId // payload clinicId is never trusted (isolation I3)
  }
  if (actor.role === 'manager') {
    if (input.role !== 'administrator') {
      throw new HttpError(403, 'Managers can only create administrator accounts')
    }
    if (input.clinicId === undefined) {
      throw new HttpError(400, 'clinicId is required')
    }
    return input.clinicId
  }
  // superadmin: anything, but hospital roles must stay clinic-less.
  if (input.role === 'superadmin' || input.role === 'manager') return null
  if (input.clinicId === undefined) {
    throw new HttpError(400, 'clinicId is required for this role')
  }
  return input.clinicId
}

export async function create(input: CreateUserRequest, actor: Actor): Promise<User> {
  if (input.role === 'superadmin' && actor.role !== 'superadmin') {
    throw new HttpError(403, 'Only a superadmin can create superadmin accounts')
  }
  const clinicId = resolveCreateClinic(input, actor)
  if (clinicId !== null) await assertClinicUsable(clinicId)
  const existingEmail = await query(
    'SELECT id FROM users WHERE email = $1 AND is_deleted = FALSE',
    [input.email],
  )
  if (existingEmail.rows.length > 0) throw new HttpError(409, 'Email already in use')
  const existingUsername = await query(
    'SELECT id FROM users WHERE username = $1 AND is_deleted = FALSE',
    [input.username],
  )
  if (existingUsername.rows.length > 0) throw new HttpError(409, 'Username already in use')
  const passwordHash = await bcrypt.hash(input.password, 12)
  const row = await withTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO users (email, username, password_hash, role, first_name, last_name, clinic_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [input.email, input.username, passwordHash, input.role, input.firstName, input.lastName, clinicId],
    )
    const insertedId = res.rows[0]?.id
    if (insertedId === undefined) throw new HttpError(500, 'Failed to create user')
    await recordActivity(client, {
      userId: actor.id,
      action: 'user.created',
      entityType: 'user',
      entityId: insertedId,
      clinicId,
      detail: {
        email: input.email,
        username: input.username,
        role: input.role,
        firstName: input.firstName,
        lastName: input.lastName,
      },
    })
    return selectUserById(client, insertedId)
  })
  return toUser(row)
}

export async function update(id: number, input: UpdateUserRequest, actor: Actor): Promise<User> {
  const existing = await getById(id, actor)
  if (actor.role !== 'superadmin') {
    if (existing.role === 'superadmin' || input.role === 'superadmin') {
      throw new HttpError(403, 'Only a superadmin can manage superadmin accounts')
    }
    if (actor.role === 'manager' && existing.role !== 'administrator') {
      throw new HttpError(403, 'Managers can only manage administrator accounts')
    }
    if (actor.role === 'manager' && input.role !== undefined && input.role !== 'administrator') {
      throw new HttpError(403, 'Managers can only manage administrator accounts')
    }
  }
  const clinicChanged = input.clinicId !== undefined && input.clinicId !== existing.clinicId
  if (clinicChanged) {
    if (actor.role !== 'superadmin' && actor.role !== 'manager') {
      throw new HttpError(403, 'Clinic reassignment is not allowed for this role')
    }
    if (actor.role === 'manager' && existing.role !== 'administrator') {
      throw new HttpError(403, 'Managers can only manage administrator accounts')
    }
    await assertClinicUsable(input.clinicId as number)
  }
  if (input.email !== undefined && input.email !== existing.email) {
    const dup = await query('SELECT id FROM users WHERE email = $1 AND is_deleted = FALSE AND id <> $2', [
      input.email,
      id,
    ])
    if (dup.rows.length > 0) throw new HttpError(409, 'Email already in use')
  }
  if (input.username !== undefined && input.username !== existing.username) {
    const dup = await query('SELECT id FROM users WHERE username = $1 AND is_deleted = FALSE AND id <> $2', [
      input.username,
      id,
    ])
    if (dup.rows.length > 0) throw new HttpError(409, 'Username already in use')
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
    ['clinic_id', input.clinicId],
  ]
  for (const [col, value] of map) {
    if (value !== undefined) {
      params.push(value)
      sets.push(`${col} = $${params.length}`)
    }
  }
  // Keep users_clinic_role_check satisfiable: hospital roles carry no clinic;
  // clinic roles need one (payload clinicId or the row's existing clinic).
  const targetRole = input.role ?? existing.role
  if ((targetRole === 'manager' || targetRole === 'superadmin') && input.clinicId === undefined) {
    params.push(null)
    sets.push(`clinic_id = $${params.length}`)
  } else if (
    (targetRole === 'administrator' || targetRole === 'doctor') &&
    input.clinicId === undefined &&
    existing.clinicId === null
  ) {
    throw new HttpError(400, 'clinicId is required for this role')
  }
  if (sets.length === 0) return getById(id, actor)
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
  if (clinicChanged) {
    before.clinicId = existing.clinicId
    after.clinicId = input.clinicId
  }
  const action = isActiveChanged
    ? input.isActive
      ? 'user.reactivated'
      : 'user.deactivated'
    : 'user.updated'
  const row = await withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} AND is_deleted = FALSE RETURNING id`,
      params,
    )
    if (res.rows.length === 0) throw new HttpError(404, 'User not found')
    // A doctor's clinic must stay in lockstep with the user row (§1.1).
    if (existing.role === 'doctor' && clinicChanged) {
      await client.query(`UPDATE doctors SET clinic_id = $1, updated_at = NOW() WHERE user_id = $2`, [
        input.clinicId,
        id,
      ])
    }
    if (Object.keys(before).length > 0) {
      await recordActivity(client, {
        userId: actor.id,
        action,
        entityType: 'user',
        entityId: id,
        clinicId: clinicChanged ? input.clinicId : existing.clinicId,
        detail: { before, after },
      })
    }
    return selectUserById(client, id)
  })
  return toUser(row)
}

export async function remove(id: number, actor: Actor): Promise<void> {
  const existing = await getById(id, actor)
  if (existing.role === 'superadmin' && actor.role !== 'superadmin') {
    throw new HttpError(403, 'Only a superadmin can manage superadmin accounts')
  }
  if (actor.role === 'manager' && existing.role !== 'administrator') {
    throw new HttpError(403, 'Managers can only manage administrator accounts')
  }
  // Soft delete: keeps doctor/duty/audit references intact (schema Phase 12).
  await withTransaction(async (client) => {
    const res = await client.query(
      'UPDATE users SET is_deleted = TRUE, is_active = FALSE, updated_at = NOW() WHERE id = $1 AND is_deleted = FALSE RETURNING id',
      [id],
    )
    if (res.rows.length === 0) throw new HttpError(404, 'User not found')
    await recordActivity(client, {
      userId: actor.id,
      action: 'user.deleted',
      entityType: 'user',
      entityId: id,
      clinicId: existing.clinicId,
      detail: { email: existing.email, username: existing.username },
    })
  })
  await tokenService.revokeAllForUser(id)
}

// Self-service UI preference: any authenticated user toggles their own theme.
// Not part of admin update() — admins never touch another user's dark mode.
export async function updateTheme(userId: number, darkMode: boolean): Promise<User> {
  const res = await query<UserRow>(
    `UPDATE users u SET dark_mode = $1, updated_at = NOW() WHERE u.id = $2 AND u.is_deleted = FALSE
     RETURNING u.id, u.email, u.username, u.password_hash, u.role, u.first_name, u.last_name,
       u.is_active, u.dark_mode, u.clinic_id, NULL AS clinic_name, u.created_at`,
    [darkMode, userId],
  )
  const row = oneRow(res.rows)
  if (!row) throw new HttpError(404, 'User not found')
  return toUser(row)
}
