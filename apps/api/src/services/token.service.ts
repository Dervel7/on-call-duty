import type { QueryResult } from 'pg'
import { env } from '../config/env'
import { query } from '../db/client'
import { HttpError } from '../lib/http-error'
import { generateRefreshToken, hashToken } from '../lib/token'

interface TokenRow {
  id: number
  user_id: number
  expires_at: Date
  revoked_at: Date | null
  replaced_by: number | null
}

export function refreshExpiryMs(): number {
  const raw = env.JWT_REFRESH_EXPIRES_IN.trim()
  if (raw.endsWith('d')) {
    const days = Number(raw.slice(0, -1))
    if (Number.isFinite(days) && days > 0) return days * 86_400_000
  }
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 7 * 86_400_000
}

function expiryDate(): Date {
  return new Date(Date.now() + refreshExpiryMs())
}

async function insertToken(userId: number): Promise<string> {
  const token = generateRefreshToken()
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hashToken(token), expiryDate()],
  )
  return token
}

async function getRow(token: string): Promise<TokenRow | undefined> {
  const res = await query<TokenRow>(
    `SELECT id, user_id, expires_at, revoked_at, replaced_by
     FROM refresh_tokens WHERE token_hash = $1`,
    [hashToken(token)],
  )
  return res.rows[0]
}

async function collectFamily(startId: number): Promise<number[]> {
  const ids: number[] = []
  let rootId = startId
  for (let i = 0; i < 1000; i++) {
    const up = await query<{ id: number }>(
      `SELECT id FROM refresh_tokens WHERE replaced_by = $1`,
      [rootId],
    )
    const prev = up.rows[0]?.id
    if (prev === undefined) break
    rootId = prev
  }
  const seen = new Set<number>()
  let cur: number | undefined = rootId
  for (let i = 0; i < 1000 && cur !== undefined; i++) {
    if (seen.has(cur)) break
    seen.add(cur)
    ids.push(cur)
    const down: QueryResult<{ id: number; replaced_by: number | null }> = await query(
      `SELECT id, replaced_by FROM refresh_tokens WHERE id = $1`,
      [cur],
    )
    const row = down.rows[0]
    if (!row) break
    cur = row.replaced_by ?? undefined
  }
  return ids
}

async function revokeFamily(startId: number): Promise<void> {
  const ids = await collectFamily(startId)
  if (ids.length === 0) return
  await query(
    `UPDATE refresh_tokens
     SET revoked_at = COALESCE(revoked_at, NOW())
     WHERE id = ANY($1::int[]) AND revoked_at IS NULL`,
    [ids],
  )
}

export async function issueRefreshToken(userId: number): Promise<string> {
  return insertToken(userId)
}

export async function rotateRefreshToken(
  oldToken: string,
): Promise<{ token: string; userId: number }> {
  const row = await getRow(oldToken)
  if (!row) throw new HttpError(401, 'Invalid refresh token')
  const now = new Date()
  const expired = row.expires_at.getTime() < now.getTime()
  if (row.revoked_at || expired) {
    if (row.revoked_at) await revokeFamily(row.id)
    throw new HttpError(401, 'Invalid refresh token')
  }
  const newToken = generateRefreshToken()
  const ins = await query<{ id: number }>(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3) RETURNING id`,
    [row.user_id, hashToken(newToken), expiryDate()],
  )
  const newId = ins.rows[0]?.id
  await query(
    `UPDATE refresh_tokens SET revoked_at = $1, replaced_by = $2 WHERE id = $3`,
    [now, newId, row.id],
  )
  return { token: newToken, userId: row.user_id }
}

export async function revokeRefreshToken(token: string): Promise<number | null> {
  const res = await query<{ user_id: number }>(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL
     RETURNING user_id`,
    [hashToken(token)],
  )
  return res.rows[0]?.user_id ?? null
}

export async function revokeAllForUser(userId: number): Promise<void> {
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  )
}
