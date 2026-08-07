import { Router } from 'express'
import { reportsController } from '../controllers/reports.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import { reportQuerySchema } from '../validators/reports'

export const reportsRouter = Router()

reportsRouter.use(authenticate)
reportsRouter.use(authorize('administrator'))
reportsRouter.get('/monthly', validate(reportQuerySchema, 'query'), reportsController.monthly)
