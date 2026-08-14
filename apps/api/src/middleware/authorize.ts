import type { NextFunction, Request, Response } from 'express'
import type { Role } from '@oncall/shared'
import { HttpError } from '../lib/http-error'

export function authorize(...roles: Role[]) {
  const allowed = new Set<Role>(roles)
  if (roles.includes('administrator')) allowed.add('superadmin')
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !allowed.has(req.user.role)) {
      throw new HttpError(403, 'Forbidden')
    }
    next()
  }
}
