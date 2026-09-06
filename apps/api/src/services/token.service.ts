import type { PoolClient } from 'pg'
import { env } from '../config/env'
import { query, withTransaction } from '../db/client'
import { HttpError } from '../lib/http-error'
import { generateRefreshToken, hashToken } from '../lib/token'

interface TokenRow {
  id: number
  user_id: number
  expires_at: Date
  revoked_at: Date | null
  replaced_by: number | null
}

const DAY_MS = 86_400_000

// env.ts enforces the "<n>d" format; parsing cannot fail at runtime.
export function refreshExpiryMs(): number {
  return Number(env.JWT_REFRESH_EXPIRES_IN.slice(0, -1)) * DAY_MS
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

/** Whole rotation chain around a token: every ancestor and descendant. */
async function collectFamily(startId: number): Promise<number[]> {
  const res = await query<{ id: number }>(
    `WITH RECURSIVE family AS (
       SELECT id, replaced_by FROM refresh_tokens WHERE id = $1
       UNION
       SELECT r.id, r.replaced_by FROM refresh_tokens r
       JOIN family f ON r.replaced_by = f.id OR r.id = f.replaced_by
     )
     SELECT id FROM family`,
    [startId],
  )
  return res.rows.map((r) => r.id)
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
  const expired = row.expires_at.getTime() < Date.now()
  if (row.revoked_at || expired) {
    if (row.revoked_at) await revokeFamily(row.id)
    throw new HttpError(401, 'Invalid refresh token')
  }
  try {
    return await withTransaction(async (client: PoolClient) => {
      const newToken = generateRefreshToken()
      const ins = await client.query<{ id: number }>(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3) RETURNING id`,
        // Absolute cap: rotation never extends the session deadline set at login.
        [row.user_id, hashToken(newToken), new Date(Math.min(Date.now() + refreshExpiryMs(), row.expires_at.getTime()))],
      )
      const newId = ins.rows[0]?.id
      // Atomic claim: zero rows means a concurrent rotation already consumed
      // this token — treat as reuse and revoke the whole family.
      const claim = await client.query(
        `UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by = $1
         WHERE id = $2 AND revoked_at IS NULL RETURNING id`,
        [newId, row.id],
      )
      if (claim.rows.length === 0) {
        throw new HttpError(401, 'Invalid refresh token')
      }
      return { token: newToken, userId: row.user_id }
    })
  } catch (err) {
    if (err instanceof HttpError) await revokeFamily(row.id)
    throw err
  }
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
