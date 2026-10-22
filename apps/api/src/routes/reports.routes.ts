import { Router } from 'express'
import { reportsController } from '../controllers/reports.controller.ts'
import { authenticate } from '../middleware/authenticate.ts'
import { authorize } from '../middleware/authorize.ts'
import { validate } from '../middleware/validate.ts'
import { reportQuerySchema } from '../validators/reports.ts'

export const reportsRouter = Router()

reportsRouter.use(authenticate)
reportsRouter.use(authorize('administrator', 'manager'))
reportsRouter.get('/monthly', validate(reportQuerySchema, 'query'), reportsController.monthly)
