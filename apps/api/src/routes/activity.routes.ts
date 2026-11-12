import { Router } from 'express'
import { activityQuerySchema } from '@oncall/shared'
import { activityController } from '../controllers/activity.controller.ts'
import { authenticate } from '../middleware/authenticate.ts'
import { authorize } from '../middleware/authorize.ts'
import { validate } from '../middleware/validate.ts'

export const activityRouter = Router()

activityRouter.use(authenticate, authorize('superadmin', 'manager'))
activityRouter.get('/', validate(activityQuerySchema, 'query'), activityController.list)
