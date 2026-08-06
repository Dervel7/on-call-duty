import { Router } from 'express'
import { userController } from '../controllers/user.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import { createUserSchema, idParams, updateUserSchema } from '../validators/user'

export const userRouter = Router()

userRouter.use(authenticate, authorize('administrator'))

userRouter.get('/', userController.list)
userRouter.get('/:id', validate(idParams, 'params'), userController.getById)
userRouter.post('/', validate(createUserSchema, 'body'), userController.create)
userRouter.patch('/:id', validate(idParams, 'params'), validate(updateUserSchema, 'body'), userController.update)
userRouter.delete('/:id', validate(idParams, 'params'), userController.remove)
