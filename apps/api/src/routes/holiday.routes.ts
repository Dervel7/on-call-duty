import { Router } from 'express'
import {
  clinicQuerySchema,
  holidayQuerySchema,
  setMonthHolidaysSchema,
} from '@oncall/shared'
import { holidayController } from '../controllers/holiday.controller.ts'
import { authenticate } from '../middleware/authenticate.ts'
import { authorize } from '../middleware/authorize.ts'
import { validate } from '../middleware/validate.ts'

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
  validate(clinicQuerySchema, 'query'),
  validate(setMonthHolidaysSchema, 'body'),
  holidayController.setMonth,
)
