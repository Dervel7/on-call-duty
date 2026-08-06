import { Router } from 'express'
import { authController } from '../controllers/auth.controller'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { changePasswordSchema, loginSchema } from '../validators/auth'

export const authRouter = Router()

authRouter.post('/login', validate(loginSchema, 'body'), authController.login)
authRouter.post('/refresh', authController.refresh)
authRouter.post('/logout', authController.logout)
authRouter.get('/me', authenticate, authController.me)
authRouter.post('/change-password', authenticate, validate(changePasswordSchema, 'body'), authController.changePassword)
