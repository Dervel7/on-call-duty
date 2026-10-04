import { Router } from 'express'
import { settingsController } from '../controllers/settings.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import {
  dutySlotsQuerySchema,
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

// Per-clinic on-call capacity (open, day after open, closed): administrators tune their
// own clinic's counts (superadmin names the clinic via ?clinicId= when there
// are several); the engine, previews, duty edits, and publishing consume them.
settingsRouter.get(
  '/duty-slots',
  authorize('administrator'),
  validate(dutySlotsQuerySchema, 'query'),
  settingsController.getDutySlots,
)
settingsRouter.patch(
  '/duty-slots',
  authorize('administrator'),
  validate(dutySlotsQuerySchema, 'query'),
  validate(updateDutySlotsSchema, 'body'),
  settingsController.updateDutySlots,
)

// Per-clinic hard minimum of on-call doctors per day type (open, day after
// open, closed); same clinic scoping as the slots. Each must stay within its
// slot count; the engine, plans, duty removal, and publishing enforce it.
settingsRouter.get(
  '/duty-minimums',
  authorize('administrator'),
  validate(dutySlotsQuerySchema, 'query'),
  settingsController.getDutyMinimums,
)
settingsRouter.patch(
  '/duty-minimums',
  authorize('administrator'),
  validate(dutySlotsQuerySchema, 'query'),
  validate(updateDutyMinimumsSchema, 'body'),
  settingsController.updateDutyMinimums,
)
