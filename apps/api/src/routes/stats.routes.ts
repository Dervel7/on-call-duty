import { Router } from 'express'
import { statsController } from '../controllers/stats.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import { statsQuerySchema } from '../validators/stats'

export const statsRouter = Router()

statsRouter.use(authenticate)
statsRouter.get('/admin', authorize('administrator'), validate(statsQuerySchema, 'query'), statsController.admin)
statsRouter.get('/me', statsController.me)
