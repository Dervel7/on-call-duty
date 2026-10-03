import { Router } from 'express'
import { unavailabilityController } from '../controllers/unavailability.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import {
  createUnavailabilityAdminSchema,
  createUnavailabilitySelfSchema,
  idParams,
  setUnavailabilityDisabledSchema,
  splitUnavailabilitySchema,
  unavailabilityQuerySchema,
  updateUnavailabilitySchema,
} from '../validators/unavailability'

export const unavailabilityRouter = Router()

unavailabilityRouter.use(authenticate)
unavailabilityRouter.get('/', authorize('administrator', 'manager'), validate(unavailabilityQuerySchema, 'query'), unavailabilityController.list)
unavailabilityRouter.get('/me', unavailabilityController.listMe)
unavailabilityRouter.post('/', authorize('administrator'), validate(unavailabilityQuerySchema, 'query'), validate(createUnavailabilityAdminSchema, 'body'), unavailabilityController.create)
unavailabilityRouter.post('/me', validate(createUnavailabilitySelfSchema, 'body'), unavailabilityController.createMe)
unavailabilityRouter.patch('/:id', validate(idParams, 'params'), validate(updateUnavailabilitySchema, 'body'), unavailabilityController.update)
unavailabilityRouter.patch('/:id/disabled', authorize('administrator'), validate(idParams, 'params'), validate(setUnavailabilityDisabledSchema, 'body'), unavailabilityController.setDisabled)
unavailabilityRouter.post('/:id/split', validate(idParams, 'params'), validate(splitUnavailabilitySchema, 'body'), unavailabilityController.split)
unavailabilityRouter.delete('/:id', validate(idParams, 'params'), unavailabilityController.remove)
