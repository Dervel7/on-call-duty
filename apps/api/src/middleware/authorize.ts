import type { NextFunction, Request, Response } from 'express'
import type { Role } from '@oncall/shared'
import { HttpError } from '../lib/http-error'

export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new HttpError(403, 'Forbidden')
    }
    next()
  }
}
