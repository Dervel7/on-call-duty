import type { CookieOptions, NextFunction, Request, Response } from 'express'
import { env } from '../config/env'
import { ok } from '../lib/envelope'
import { HttpError } from '../lib/http-error'
import * as authService from '../services/auth.service'
import { refreshExpiryMs } from '../services/token.service'

const COOKIE_NAME = 'refresh_token'

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    domain: env.COOKIE_DOMAIN,
    path: '/auth',
    maxAge: refreshExpiryMs(),
  }
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, cookieOptions())
}

function clearRefreshCookie(res: Response): void {
  // No maxAge: express turns it into a future Expires that keeps the cookie
  // alive instead of deleting it.
  const { maxAge: _maxAge, ...clear } = cookieOptions()
  res.clearCookie(COOKIE_NAME, clear)
}

export const authController = {
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { user, accessToken, refreshToken } = await authService.login(req.body)
      setRefreshCookie(res, refreshToken)
      res.status(200).json(ok({ user, accessToken }))
    } catch (err) {
      next(err)
    }
  },
  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.cookies?.[COOKIE_NAME]
      if (!token) throw new HttpError(401, 'Invalid refresh token')
      const { user, accessToken, refreshToken } = await authService.refresh(token)
      setRefreshCookie(res, refreshToken)
      res.status(200).json(ok({ user, accessToken }))
    } catch (err) {
      // A dead cookie must not linger: clear it so clients stop replaying it.
      clearRefreshCookie(res)
      next(err)
    }
  },
  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.cookies?.[COOKIE_NAME]
      if (token) await authService.logout(token)
      clearRefreshCookie(res)
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },
  async me(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      const user = await authService.getUser(req.user.id)
      res.status(200).json(ok({ user }))
    } catch (err) {
      next(err)
    }
  },
  async changePassword(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      const user = await authService.changePassword(req.user.id, req.body)
      res.status(200).json(ok({ user }))
    } catch (err) {
      next(err)
    }
  },
}
