import { Router } from 'express'
import { doctorController } from '../controllers/doctor.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import { createDoctorSchema, doctorQuerySchema, idParams, updateDoctorSchema } from '../validators/doctor'

export const doctorRouter = Router()

doctorRouter.use(authenticate)
// Manager is read-only on doctors (D5); writes stay administrator-only.
doctorRouter.get(
  '/',
  authorize('administrator', 'manager'),
  validate(doctorQuerySchema, 'query'),
  doctorController.list,
)
doctorRouter.get('/me', doctorController.getMe)
doctorRouter.get(
  '/:id',
  authorize('administrator', 'manager'),
  validate(idParams, 'params'),
  doctorController.getById,
)
doctorRouter.post(
  '/',
  authorize('administrator'),
  validate(doctorQuerySchema, 'query'),
  validate(createDoctorSchema, 'body'),
  doctorController.create,
)
doctorRouter.patch(
  '/:id',
  authorize('administrator'),
  validate(idParams, 'params'),
  validate(updateDoctorSchema, 'body'),
  doctorController.update,
)
doctorRouter.delete(
  '/:id',
  authorize('administrator'),
  validate(idParams, 'params'),
  doctorController.remove,
)
