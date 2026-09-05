import { Router } from 'express'
import { usageController } from '../controllers/usage.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import { idParams } from '../validators/user'

export const usageRouter = Router()

usageRouter.use(authenticate)
usageRouter.get('/generations', authorize('superadmin'), usageController.generations)
usageRouter.get('/alerts', authorize('superadmin'), usageController.alerts)
usageRouter.patch(
  '/alerts/:id/resolve',
  authorize('superadmin'),
  validate(idParams, 'params'),
  usageController.resolveAlert,
)
