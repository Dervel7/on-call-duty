import { Router } from 'express'
import { authController } from '../controllers/auth.controller'
import { authenticate } from '../middleware/authenticate'
import { rateLimit } from '../middleware/rate-limit'
import { validate } from '../middleware/validate'
import { changePasswordSchema, loginSchema } from '../validators/auth'

export const authRouter = Router()

const FIFTEEN_MINUTES_MS = 15 * 60_000

authRouter.post(
  '/login',
  validate(loginSchema, 'body'),
  // Per IP across all identifiers: stops one client spraying passwords over
  // many accounts. Generous because a hospital network shares one NAT address.
  rateLimit({ windowMs: FIFTEEN_MINUTES_MS, limit: 100 }),
  rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    limit: 10,
    keyFn: (req) => `${req.ip ?? 'unknown'}:${String(req.body?.identifier ?? '')}`,
  }),
  authController.login,
)
authRouter.post('/refresh', rateLimit({ windowMs: FIFTEEN_MINUTES_MS, limit: 60 }), authController.refresh)
authRouter.post('/logout', authController.logout)
authRouter.get('/me', authenticate, authController.me)
authRouter.post(
  '/change-password',
  authenticate,
  validate(changePasswordSchema, 'body'),
  // Per account: a hijacked session must not be able to brute-force the current password.
  rateLimit({ windowMs: FIFTEEN_MINUTES_MS, limit: 10, keyFn: (req) => `user:${req.user?.id ?? 'unknown'}` }),
  authController.changePassword,
)
