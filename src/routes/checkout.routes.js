import { Router } from 'express'
import requireAuth from '../middleware/requireAuth.js'
import { validate } from '../middleware/validate.middleware.js'
import { startCheckoutSchema } from '../schemas/checkout.schema.js'
import {
  createBillingPortalSession,
  startPlanCheckout,
} from '../controllers/checkout.controller.js'

const router = Router()

router.post('/start', requireAuth, validate(startCheckoutSchema), startPlanCheckout)
router.post('/portal', requireAuth, createBillingPortalSession)

export default router
