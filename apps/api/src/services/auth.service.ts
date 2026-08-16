import bcrypt from 'bcrypt'
import { query } from '../db/client'
import { HttpError } from '../lib/http-error'
import { signAccessToken } from '../lib/jwt'
import type { AuthUser, ChangePasswordRequest, LoginRequest, Role } from '@oncall/shared'
import { logActivity } from './activity.service'
import * as tokenService from './token.service'

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

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    role: row.role,
    firstName: row.first_name,
    lastName: row.last_name,
  }
}

const USER_COLUMNS = `id, email, username, password_hash, role, first_name, last_name, is_active, created_at`

async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  const res = await query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE email = $1 AND is_deleted = FALSE`,
    [email],
  )
  return res.rows[0]
}

async function findUserByUsername(username: string): Promise<UserRow | undefined> {
  const res = await query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE username = $1 AND is_deleted = FALSE`,
    [username],
  )
  return res.rows[0]
}

async function findUserById(id: number): Promise<UserRow | undefined> {
  const res = await query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND is_deleted = FALSE`,
    [id],
  )
  return res.rows[0]
}

export async function login(
  input: LoginRequest,
): Promise<{ user: AuthUser; accessToken: string; refreshToken: string }> {
  const row = input.identifier.includes('@')
    ? await findUserByEmail(input.identifier)
    : await findUserByUsername(input.identifier)
  if (!row) throw new HttpError(401, 'Invalid credentials')
  const ok = await bcrypt.compare(input.password, row.password_hash)
  if (!ok) throw new HttpError(401, 'Invalid credentials')
  if (!row.is_active) throw new HttpError(403, 'Account disabled')
  const accessToken = signAccessToken({ sub: row.id, role: row.role })
  const refreshToken = await tokenService.issueRefreshToken(row.id)
  await logActivity({ userId: row.id, action: 'auth.login', entityType: 'auth', entityId: null })
  return { user: toAuthUser(row), accessToken, refreshToken }
}

export async function refresh(
  oldToken: string,
): Promise<{ user: AuthUser; accessToken: string; refreshToken: string }> {
  const { token: newToken, userId } = await tokenService.rotateRefreshToken(oldToken)
  const row = await findUserById(userId)
  if (!row) throw new HttpError(401, 'Invalid refresh token')
  if (!row.is_active) throw new HttpError(403, 'Account disabled')
  const accessToken = signAccessToken({ sub: row.id, role: row.role })
  return { user: toAuthUser(row), accessToken, refreshToken: newToken }
}

export async function logout(token: string): Promise<void> {
  const userId = await tokenService.revokeRefreshToken(token)
  if (userId === null) return
  await logActivity({ userId, action: 'auth.logout', entityType: 'auth', entityId: null })
}

export async function getUser(id: number): Promise<AuthUser> {
  const row = await findUserById(id)
  if (!row) throw new HttpError(404, 'User not found')
  return toAuthUser(row)
}

export async function changePassword(
  userId: number,
  input: ChangePasswordRequest,
): Promise<AuthUser> {
  const row = await findUserById(userId)
  if (!row) throw new HttpError(404, 'User not found')
  const ok = await bcrypt.compare(input.currentPassword, row.password_hash)
  if (!ok) throw new HttpError(401, 'Current password is incorrect')
  const newHash = await bcrypt.hash(input.newPassword, 12)
  await query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [
    newHash,
    row.id,
  ])
  await tokenService.revokeAllForUser(userId)
  await logActivity({
    userId,
    action: 'auth.password_changed',
    entityType: 'user',
    entityId: userId,
  })
  return toAuthUser(row)
}
