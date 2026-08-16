import { Router } from 'express'
import { activityController } from '../controllers/activity.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import { activityQuerySchema } from '../validators/activity'

export const activityRouter = Router()

activityRouter.use(authenticate, authorize('administrator'))
activityRouter.get('/', validate(activityQuerySchema, 'query'), activityController.list)
