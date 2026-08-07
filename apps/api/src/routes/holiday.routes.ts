import { Router } from 'express'
import { holidayController } from '../controllers/holiday.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import {
  createHolidaySchema,
  holidayQuerySchema,
  idParams,
  updateHolidaySchema,
} from '../validators/holiday'

export const holidayRouter = Router()

holidayRouter.use(authenticate)
holidayRouter.get('/', validate(holidayQuerySchema, 'query'), holidayController.list)
holidayRouter.post('/', authorize('administrator'), validate(createHolidaySchema, 'body'), holidayController.create)
holidayRouter.patch('/:id', authorize('administrator'), validate(idParams, 'params'), validate(updateHolidaySchema, 'body'), holidayController.update)
holidayRouter.delete('/:id', authorize('administrator'), validate(idParams, 'params'), holidayController.remove)
