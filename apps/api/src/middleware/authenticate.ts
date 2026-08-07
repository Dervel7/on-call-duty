import type { NextFunction, Request, Response } from 'express'
import { HttpError } from '../lib/http-error'
import { verifyAccessToken } from '../lib/jwt'

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    throw new HttpError(401, 'Unauthorized')
  }
  try {
    const payload = verifyAccessToken(header.slice('Bearer '.length))
    req.user = { id: payload.sub, role: payload.role }
    next()
  } catch {
    throw new HttpError(401, 'Unauthorized')
  }
}
