import { Router } from 'express'
import { idParamsSchema } from '@oncall/shared'
import { usageController } from '../controllers/usage.controller.ts'
import { authenticate } from '../middleware/authenticate.ts'
import { authorize } from '../middleware/authorize.ts'
import { validate } from '../middleware/validate.ts'

export const usageRouter = Router()

usageRouter.use(authenticate)
usageRouter.get('/generations', authorize('superadmin'), usageController.generations)
usageRouter.get('/alerts', authorize('superadmin'), usageController.alerts)
usageRouter.patch(
  '/alerts/:id/resolve',
  authorize('superadmin'),
  validate(idParamsSchema, 'params'),
  usageController.resolveAlert,
)
