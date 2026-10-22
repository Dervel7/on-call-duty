import { Router } from 'express'
import { holidayController } from '../controllers/holiday.controller.ts'
import { authenticate } from '../middleware/authenticate.ts'
import { authorize } from '../middleware/authorize.ts'
import { validate } from '../middleware/validate.ts'
import { holidayQuerySchema, setMonthHolidaysSchema } from '../validators/holiday.ts'

export const holidayRouter = Router()

holidayRouter.use(authenticate)
holidayRouter.get(
  '/',
  authorize('administrator', 'manager'),
  validate(holidayQuerySchema, 'query'),
  holidayController.list,
)
holidayRouter.put(
  '/month',
  authorize('administrator'),
  validate(setMonthHolidaysSchema, 'body'),
  holidayController.setMonth,
)
