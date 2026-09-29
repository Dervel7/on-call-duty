import { Router } from 'express'
import { settingsController } from '../controllers/settings.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import { updateOpenDutySchema } from '../validators/settings'

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
