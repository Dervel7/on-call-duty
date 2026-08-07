import jwt, { type SignOptions } from 'jsonwebtoken'
import type { Role } from '@oncall/shared'
import { env } from '../config/env'

export interface JwtAccessPayload {
  sub: number
  role: Role
}

export function signAccessToken(payload: JwtAccessPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as unknown as SignOptions['expiresIn'],
  })
}

export function verifyAccessToken(token: string): JwtAccessPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as unknown as JwtAccessPayload
}
