import { Router } from 'express'
import { usageController } from '../controllers/usage.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'

export const usageRouter = Router()

usageRouter.use(authenticate)
usageRouter.get('/summary', authorize('superadmin'), usageController.summary)
usageRouter.get('/generations', authorize('superadmin'), usageController.generations)
usageRouter.get('/alerts', authorize('superadmin'), usageController.alerts)
usageRouter.patch('/alerts/:id/resolve', authorize('superadmin'), usageController.resolveAlert)
