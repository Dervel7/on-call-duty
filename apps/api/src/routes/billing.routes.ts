import { Router } from 'express'
import { billingController } from '../controllers/billing.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import { updateBillingSchema } from '../validators/settings'

export const billingRouter = Router()

billingRouter.use(authenticate)
billingRouter.get('/', authorize('superadmin'), billingController.getState)
billingRouter.patch(
  '/',
  authorize('superadmin'),
  validate(updateBillingSchema, 'body'),
  billingController.setPaidThrough,
)
