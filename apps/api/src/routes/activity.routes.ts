import { Router } from 'express'
import { activityController } from '../controllers/activity.controller.ts'
import { authenticate } from '../middleware/authenticate.ts'
import { authorize } from '../middleware/authorize.ts'
import { validate } from '../middleware/validate.ts'
import { activityQuerySchema } from '../validators/activity.ts'

export const activityRouter = Router()

activityRouter.use(authenticate, authorize('superadmin', 'manager'))
activityRouter.get('/', validate(activityQuerySchema, 'query'), activityController.list)
