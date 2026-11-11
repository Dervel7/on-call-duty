import bcrypt from 'bcrypt'
import { query } from '../db/client.ts'
import { HttpError } from '../lib/http-error.ts'

const BCRYPT_COST = 12

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST)
}

interface Queryer {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>
}

/** 409 when a live account already uses the email (case-insensitive) or username. */
export async function assertIdentityFree(
  client: Queryer,
  identity: { email?: string; username?: string },
  excludeId?: number,
): Promise<void> {
  const checks: Array<[string, string | undefined, string]> = [
    ['lower(email) = lower($1)', identity.email, 'Email already in use'],
    ['username = $1', identity.username, 'Username already in use'],
  ]
  for (const [condition, value, message] of checks) {
    if (value === undefined) continue
    const params: unknown[] = [value]
    let sql = `SELECT id FROM users WHERE ${condition} AND is_deleted = FALSE`
    if (excludeId !== undefined) {
      params.push(excludeId)
      sql += ' AND id <> $2'
    }
    const dup = await client.query(sql, params)
    if (dup.rows.length > 0) throw new HttpError(409, message)
  }
}

/** Unknown or inactive target clinic: 404/403 (creation into it is blocked, D10). */
export async function assertClinicUsable(clinicId: number): Promise<void> {
  const res = await query<{ is_active: boolean }>(`SELECT is_active FROM clinics WHERE id = $1`, [
    clinicId,
  ])
  const clinic = res.rows[0]
  if (!clinic) throw new HttpError(404, 'Clinic not found')
  if (!clinic.is_active) throw new HttpError(403, 'Clinic is deactivated')
}

/** Before/after values of the keys that `input` sets to something different from `existing`. */
export function diffFields<K extends string>(
  existing: Record<K, unknown>,
  input: Partial<Record<K, unknown>>,
  keys: readonly K[],
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  for (const key of keys) {
    if (input[key] !== undefined && input[key] !== existing[key]) {
      before[key] = existing[key]
      after[key] = input[key]
    }
  }
  return { before, after }
}
