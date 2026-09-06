import { Router } from 'express'
import { billingController } from '../controllers/billing.controller'
import { authenticate } from '../middleware/authenticate'
import { authorize } from '../middleware/authorize'
import { validate } from '../middleware/validate'
import { updateBillingSchema } from '../validators/settings'

export const billingRouter = Router()

billingRouter.use(authenticate)
// authorize('administrator') also admits superadmins; doctors get 403.
billingRouter.get('/payment-alert', authorize('administrator'), billingController.paymentAlert)
billingRouter.get('/', authorize('superadmin'), billingController.getState)
billingRouter.patch(
  '/',
  authorize('superadmin'),
  validate(updateBillingSchema, 'body'),
  billingController.setPaidThrough,
)
