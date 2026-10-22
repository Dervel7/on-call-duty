import { Router } from 'express'
import { authController } from '../controllers/auth.controller.ts'
import { authenticate } from '../middleware/authenticate.ts'
import { rateLimit } from '../middleware/rate-limit.ts'
import { validate } from '../middleware/validate.ts'
import { changePasswordSchema, loginSchema } from '../validators/auth.ts'

export const authRouter = Router()

const FIFTEEN_MINUTES_MS = 15 * 60_000

authRouter.post(
  '/login',
  validate(loginSchema, 'body'),
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
authRouter.post('/change-password', authenticate, validate(changePasswordSchema, 'body'), authController.changePassword)
