import { Router } from 'express'
import { clinicController } from '../controllers/clinic.controller.ts'
import { authenticate } from '../middleware/authenticate.ts'
import { authorize } from '../middleware/authorize.ts'
import { validate } from '../middleware/validate.ts'
import { createClinicSchema, idParams, updateClinicSchema } from '../validators/index.ts'

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
  validate(idParams, 'params'),
  validate(updateClinicSchema, 'body'),
  clinicController.update,
)
