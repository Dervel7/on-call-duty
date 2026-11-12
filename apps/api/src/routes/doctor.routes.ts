import { Router } from 'express'
import {
  clinicQuerySchema,
  createDoctorSchema,
  idParamsSchema,
  updateDoctorSchema,
} from '@oncall/shared'
import { doctorController } from '../controllers/doctor.controller.ts'
import { authenticate } from '../middleware/authenticate.ts'
import { authorize } from '../middleware/authorize.ts'
import { validate } from '../middleware/validate.ts'

export const doctorRouter = Router()

doctorRouter.use(authenticate)
// Manager is read-only on doctors (D5); writes stay administrator-only.
doctorRouter.get(
  '/',
  authorize('administrator', 'manager'),
  validate(clinicQuerySchema, 'query'),
  doctorController.list,
)
doctorRouter.get('/me', doctorController.getMe)
doctorRouter.get(
  '/:id',
  authorize('administrator', 'manager'),
  validate(idParamsSchema, 'params'),
  doctorController.getById,
)
doctorRouter.post(
  '/',
  authorize('administrator'),
  validate(clinicQuerySchema, 'query'),
  validate(createDoctorSchema, 'body'),
  doctorController.create,
)
doctorRouter.patch(
  '/:id',
  authorize('administrator'),
  validate(idParamsSchema, 'params'),
  validate(updateDoctorSchema, 'body'),
  doctorController.update,
)
doctorRouter.delete(
  '/:id',
  authorize('administrator'),
  validate(idParamsSchema, 'params'),
  doctorController.remove,
)
