import { Router } from 'express'
import { statsQuerySchema } from '@oncall/shared'
import { statsController } from '../controllers/stats.controller.ts'
import { authenticate } from '../middleware/authenticate.ts'
import { authorize } from '../middleware/authorize.ts'
import { validate } from '../middleware/validate.ts'

export const statsRouter = Router()

statsRouter.use(authenticate)
statsRouter.get('/admin', authorize('administrator', 'manager'), validate(statsQuerySchema, 'query'), statsController.admin)
statsRouter.get('/me', statsController.me)
