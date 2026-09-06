import type { NextFunction, Request, Response } from 'express'
import { SYSTEM_LOCKED_MESSAGE } from '@oncall/shared'
import { HttpError } from '../lib/http-error'
import { verifyAccessToken } from '../lib/jwt'
import * as billingService from '../services/billing.service'

// Express 4 does not catch rejected promises from middleware, so every
// failure path — including the async lock check — must reach the error
// handler through next(err).
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization
    if (!header || !header.startsWith('Bearer ')) {
      throw new HttpError(401, 'Unauthorized')
    }
    let payload
    try {
      payload = verifyAccessToken(header.slice('Bearer '.length))
    } catch {
      throw new HttpError(401, 'Unauthorized')
    }
    req.user = { id: payload.sub, role: payload.role }
    if (req.user.role !== 'superadmin' && (await billingService.isLocked())) {
      throw new HttpError(403, SYSTEM_LOCKED_MESSAGE)
    }
    next()
  } catch (err) {
    next(err)
  }
}
