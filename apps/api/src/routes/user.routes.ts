import { Router } from 'express'
import {
  clinicQuerySchema,
  createUserSchema,
  idParamsSchema,
  resetUserPasswordSchema,
  updateLanguageSchema,
  updateThemeSchema,
  updateUserSchema,
  updateUsernameSchema,
} from '@oncall/shared'
import { userController } from '../controllers/user.controller.ts'
import { authenticate } from '../middleware/authenticate.ts'
import { authorize } from '../middleware/authorize.ts'
import { validate } from '../middleware/validate.ts'

export const userRouter = Router()

// Self-service preference - registered before the admin-only guard below so
// every authenticated role (doctor included) can set their own theme.
userRouter.patch(
  '/me/theme',
  authenticate,
  validate(updateThemeSchema, 'body'),
  userController.updateTheme,
)

// Self-service preference - same placement reason as /me/theme: every
// authenticated role sets their own UI language.
userRouter.patch(
  '/me/language',
  authenticate,
  validate(updateLanguageSchema, 'body'),
  userController.updateLanguage,
)

// Self-service identity: doctors rename their own login username from the
// Profile page. Registered before the admin-only guard below so it is not
// swallowed by authorize('administrator', 'manager').
userRouter.patch(
  '/me/username',
  authenticate,
  authorize('doctor'),
  validate(updateUsernameSchema, 'body'),
  userController.updateUsername,
)

userRouter.use(authenticate, authorize('administrator', 'manager'))

userRouter.get('/', validate(clinicQuerySchema, 'query'), userController.list)
userRouter.get('/:id', validate(idParamsSchema, 'params'), userController.getById)
userRouter.post('/', validate(createUserSchema, 'body'), userController.create)
userRouter.patch('/:id', validate(idParamsSchema, 'params'), validate(updateUserSchema, 'body'), userController.update)
userRouter.patch('/:id/password', validate(idParamsSchema, 'params'), validate(resetUserPasswordSchema, 'body'), userController.resetPassword)
userRouter.delete('/:id', validate(idParamsSchema, 'params'), userController.remove)
