import { Router } from 'express'
import {
  alternativeOptionSchema,
  createDutySchema,
  createScheduleSchema,
  saveScheduleSchema,
  idParamsSchema,
  reassignDutySchema,
  scheduleQuerySchema,
} from '@oncall/shared'
import { scheduleController } from '../controllers/schedule.controller.ts'
import { authenticate } from '../middleware/authenticate.ts'
import { authorize } from '../middleware/authorize.ts'
import { validate } from '../middleware/validate.ts'

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
  validate(idParamsSchema, 'params'),
  scheduleController.getById,
)
// Writes stay administrator-only; the clinic
// comes from ?clinicId= (superadmin) or the JWT (administrator).
scheduleRouter.post(
  '/options',
  authorize('administrator'),
  validate(scheduleQuerySchema, 'query'),
  validate(createScheduleSchema, 'body'),
  scheduleController.options,
)
scheduleRouter.post(
  '/options/alternative',
  authorize('administrator'),
  validate(scheduleQuerySchema, 'query'),
  validate(alternativeOptionSchema, 'body'),
  scheduleController.alternative,
)
scheduleRouter.post(
  '/',
  authorize('administrator'),
  validate(scheduleQuerySchema, 'query'),
  validate(saveScheduleSchema, 'body'),
  scheduleController.generate,
)
scheduleRouter.post('/:id/publish', authorize('administrator'), validate(idParamsSchema, 'params'), scheduleController.publish)
scheduleRouter.post('/:id/unpublish', authorize('administrator'), validate(idParamsSchema, 'params'), scheduleController.unpublish)
scheduleRouter.delete('/:id', authorize('administrator'), validate(idParamsSchema, 'params'), scheduleController.remove)
scheduleRouter.post('/:id/duties', authorize('administrator'), validate(idParamsSchema, 'params'), validate(createDutySchema, 'body'), scheduleController.addDuty)

export const dutyRouter = Router()

dutyRouter.use(authenticate)
dutyRouter.use(authorize('administrator'))
dutyRouter.patch('/:id', validate(idParamsSchema, 'params'), validate(reassignDutySchema, 'body'), scheduleController.reassignDuty)
dutyRouter.delete('/:id', validate(idParamsSchema, 'params'), scheduleController.removeDuty)
