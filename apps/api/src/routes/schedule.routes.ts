import { Router } from 'express'
import { scheduleController } from '../controllers/schedule.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import {
  createDutySchema,
  createScheduleSchema,
  idParams,
  reassignDutySchema,
  scheduleQuerySchema,
} from '../validators/schedule'

export const scheduleRouter = Router()

scheduleRouter.use(authenticate)

scheduleRouter.get(
  '/',
  authorize('administrator', 'doctor'),
  validate(scheduleQuerySchema, 'query'),
  scheduleController.list,
)
scheduleRouter.post('/preview', authorize('administrator'), validate(createScheduleSchema, 'body'), scheduleController.preview)
scheduleRouter.post('/', authorize('administrator'), validate(createScheduleSchema, 'body'), scheduleController.generate)
scheduleRouter.get('/:id', authorize('administrator', 'doctor'), validate(idParams, 'params'), scheduleController.getById)
scheduleRouter.post('/:id/publish', authorize('administrator'), validate(idParams, 'params'), scheduleController.publish)
scheduleRouter.post('/:id/unpublish', authorize('administrator'), validate(idParams, 'params'), scheduleController.unpublish)
scheduleRouter.delete('/:id', authorize('administrator'), validate(idParams, 'params'), scheduleController.remove)
scheduleRouter.post('/:id/duties', authorize('administrator'), validate(idParams, 'params'), validate(createDutySchema, 'body'), scheduleController.addDuty)

export const dutyRouter = Router()

dutyRouter.use(authenticate)
dutyRouter.use(authorize('administrator'))
dutyRouter.patch('/:id', validate(idParams, 'params'), validate(reassignDutySchema, 'body'), scheduleController.reassignDuty)
dutyRouter.delete('/:id', validate(idParams, 'params'), scheduleController.removeDuty)
