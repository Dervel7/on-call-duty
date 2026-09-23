import { Router } from 'express'
import { clinicController } from '../controllers/clinic.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import { createClinicSchema, idParams, updateClinicSchema } from '../validators'

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
