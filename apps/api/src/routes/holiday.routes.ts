import { Router } from 'express'
import { holidayController } from '../controllers/holiday.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import {
  holidayClinicQuerySchema,
  holidayQuerySchema,
  setMonthHolidaysSchema,
} from '../validators/holiday'

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
  validate(holidayClinicQuerySchema, 'query'),
  validate(setMonthHolidaysSchema, 'body'),
  holidayController.setMonth,
)
