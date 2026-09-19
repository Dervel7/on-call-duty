import { Router } from 'express'
import { scheduleController } from '../controllers/schedule.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import {
  createDutySchema,
  createScheduleSchema,
  generateScheduleSchema,
  idParams,
  reassignDutySchema,
  scheduleQuerySchema,
} from '../validators/schedule'

export const scheduleRouter = Router()

scheduleRouter.use(authenticate)

// Reads: manager is read-only drill-down (D5/D9); doctors see own clinic's
// published schedules only (enforced in the service).
scheduleRouter.get(
  '/',
  authorize('administrator', 'doctor', 'manager'),
  validate(scheduleQuerySchema, 'query'),
  scheduleController.list,
)
scheduleRouter.get(
  '/:id',
  authorize('administrator', 'doctor', 'manager'),
  validate(idParams, 'params'),
  scheduleController.getById,
)
// Writes (preview/generate included) stay administrator-only; the clinic
// comes from ?clinicId= (superadmin) or the JWT (administrator).
scheduleRouter.post(
  '/preview',
  authorize('administrator'),
  validate(scheduleQuerySchema, 'query'),
  validate(createScheduleSchema, 'body'),
  scheduleController.preview,
)
scheduleRouter.post(
  '/',
  authorize('administrator'),
  validate(scheduleQuerySchema, 'query'),
  validate(generateScheduleSchema, 'body'),
  scheduleController.generate,
)
scheduleRouter.post('/:id/publish', authorize('administrator'), validate(idParams, 'params'), scheduleController.publish)
scheduleRouter.post('/:id/unpublish', authorize('administrator'), validate(idParams, 'params'), scheduleController.unpublish)
scheduleRouter.delete('/:id', authorize('administrator'), validate(idParams, 'params'), scheduleController.remove)
scheduleRouter.post('/:id/duties', authorize('administrator'), validate(idParams, 'params'), validate(createDutySchema, 'body'), scheduleController.addDuty)

export const dutyRouter = Router()

dutyRouter.use(authenticate)
dutyRouter.use(authorize('administrator'))
dutyRouter.patch('/:id', validate(idParams, 'params'), validate(reassignDutySchema, 'body'), scheduleController.reassignDuty)
dutyRouter.delete('/:id', validate(idParams, 'params'), scheduleController.removeDuty)
