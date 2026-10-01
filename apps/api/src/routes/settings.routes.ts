import { Router } from 'express'
import { settingsController } from '../controllers/settings.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import {
  updateDutyMinimumsSchema,
  updateDutySlotsSchema,
  updateOpenDutySchema,
} from '../validators/settings'

export const settingsRouter = Router()

settingsRouter.use(authenticate)

// Open/closed cycle config: administrators tune it (superadmin admitted by
// authorize); the values feed every schedule preview/detail response.
settingsRouter.get('/open-duty', authorize('administrator'), settingsController.getOpenDuty)
settingsRouter.patch(
  '/open-duty',
  authorize('administrator'),
  validate(updateOpenDutySchema, 'body'),
  settingsController.updateOpenDuty,
)

// Per-day on-call capacity (open vs closed days): administrators tune both
// counts; the engine, previews, duty edits, and publishing consume them.
settingsRouter.get('/duty-slots', authorize('administrator'), settingsController.getDutySlots)
settingsRouter.patch(
  '/duty-slots',
  authorize('administrator'),
  validate(updateDutySlotsSchema, 'body'),
  settingsController.updateDutySlots,
)

// Hard minimum of on-call doctors per day type (open vs closed days). Each
// must stay within its slot count; the engine, plans, duty removal, and
// publishing enforce it.
settingsRouter.get('/duty-minimums', authorize('administrator'), settingsController.getDutyMinimums)
settingsRouter.patch(
  '/duty-minimums',
  authorize('administrator'),
  validate(updateDutyMinimumsSchema, 'body'),
  settingsController.updateDutyMinimums,
)
