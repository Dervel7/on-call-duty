import { Router } from 'express'
import { monthQuerySchema } from '@oncall/shared'
import { reportsController } from '../controllers/reports.controller.ts'
import { authenticate } from '../middleware/authenticate.ts'
import { authorize } from '../middleware/authorize.ts'
import { validate } from '../middleware/validate.ts'

export const reportsRouter = Router()

reportsRouter.use(authenticate)
reportsRouter.use(authorize('administrator', 'manager'))
reportsRouter.get('/monthly', validate(monthQuerySchema, 'query'), reportsController.monthly)
