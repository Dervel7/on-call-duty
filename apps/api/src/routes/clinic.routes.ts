import { Router } from 'express'
import { createClinicSchema, idParamsSchema, updateClinicSchema } from '@oncall/shared'
import { clinicController } from '../controllers/clinic.controller.ts'
import { authenticate } from '../middleware/authenticate.ts'
import { authorize } from '../middleware/authorize.ts'
import { validate } from '../middleware/validate.ts'

export const clinicRouter = Router()

clinicRouter.use(authenticate)

clinicRouter.get('/', authorize('manager', 'superadmin'), clinicController.list)
clinicRouter.post(
  '/',
  authorize('manager', 'superadmin'),
  validate(createClinicSchema, 'body'),
  clinicController.create,
)
clinicRouter.patch(
  '/:id',
  authorize('manager', 'superadmin'),
  validate(idParamsSchema, 'params'),
  validate(updateClinicSchema, 'body'),
  clinicController.update,
)
