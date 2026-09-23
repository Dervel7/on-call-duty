import jwt, { type SignOptions } from 'jsonwebtoken'
import type { Role } from '@oncall/shared'
import { env } from '../config/env'

export interface JwtAccessPayload {
  sub: number
  role: Role
  clinicId: number | null
}

const ROLES: readonly Role[] = ['superadmin', 'manager', 'administrator', 'doctor']

export function signAccessToken(payload: JwtAccessPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as unknown as SignOptions['expiresIn'],
  })
}

export function verifyAccessToken(token: string): JwtAccessPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] })
  if (typeof decoded === 'string' || decoded === null) throw new Error('invalid token payload')
  const { sub, role, clinicId } = decoded as Record<string, unknown>
  if (typeof sub !== 'number' || !ROLES.includes(role as Role)) {
    throw new Error('invalid token payload')
  }
  // Pre-multi-clinic tokens carry no clinicId claim and must fail verification.
  if (clinicId !== null && typeof clinicId !== 'number') {
    throw new Error('invalid token payload')
  }
  return { sub, role: role as Role, clinicId }
}
