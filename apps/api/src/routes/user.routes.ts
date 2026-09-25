import { Router } from 'express'
import { userController } from '../controllers/user.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import { createUserSchema, idParams, resetUserPasswordSchema, updateThemeSchema, updateUserSchema, userQuerySchema } from '../validators/user'

export const userRouter = Router()

// Self-service preference — registered before the admin-only guard below so
// every authenticated role (doctor included) can set their own theme.
userRouter.patch(
  '/me/theme',
  authenticate,
  validate(updateThemeSchema, 'body'),
  userController.updateTheme,
)

userRouter.use(authenticate, authorize('administrator', 'manager'))

userRouter.get('/', validate(userQuerySchema, 'query'), userController.list)
userRouter.get('/:id', validate(idParams, 'params'), userController.getById)
userRouter.post('/', validate(createUserSchema, 'body'), userController.create)
userRouter.patch('/:id', validate(idParams, 'params'), validate(updateUserSchema, 'body'), userController.update)
userRouter.patch('/:id/password', validate(idParams, 'params'), validate(resetUserPasswordSchema, 'body'), userController.resetPassword)
userRouter.delete('/:id', validate(idParams, 'params'), userController.remove)
