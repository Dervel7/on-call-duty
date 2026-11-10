import { Router } from 'express'
import {
  clinicQuerySchema,
  createUnavailabilityAdminSchema,
  createUnavailabilitySelfSchema,
  idParamsSchema,
  setUnavailabilityDisabledSchema,
  splitUnavailabilitySchema,
  unavailabilityQuerySchema,
  updateUnavailabilitySchema,
} from '@oncall/shared'
import { unavailabilityController } from '../controllers/unavailability.controller.ts'
import { authenticate } from '../middleware/authenticate.ts'
import { authorize } from '../middleware/authorize.ts'
import { validate } from '../middleware/validate.ts'

export const unavailabilityRouter = Router()

unavailabilityRouter.use(authenticate)
unavailabilityRouter.get('/', authorize('administrator', 'manager'), validate(unavailabilityQuerySchema, 'query'), unavailabilityController.list)
unavailabilityRouter.get('/me', unavailabilityController.listMe)
unavailabilityRouter.post('/', authorize('administrator'), validate(clinicQuerySchema, 'query'), validate(createUnavailabilityAdminSchema, 'body'), unavailabilityController.create)
unavailabilityRouter.post('/me', validate(createUnavailabilitySelfSchema, 'body'), unavailabilityController.createMe)
unavailabilityRouter.patch('/:id', validate(idParamsSchema, 'params'), validate(updateUnavailabilitySchema, 'body'), unavailabilityController.update)
unavailabilityRouter.patch('/:id/disabled', authorize('administrator'), validate(idParamsSchema, 'params'), validate(setUnavailabilityDisabledSchema, 'body'), unavailabilityController.setDisabled)
unavailabilityRouter.post('/:id/split', validate(idParamsSchema, 'params'), validate(splitUnavailabilitySchema, 'body'), unavailabilityController.split)
unavailabilityRouter.delete('/:id', validate(idParamsSchema, 'params'), unavailabilityController.remove)
