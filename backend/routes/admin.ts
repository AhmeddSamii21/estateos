import { Router } from 'express'
import { authMiddleware, requireRole } from '../middleware/auth'
import { MANAGEMENT_ROLES, organizationIdOf } from '../utils/scope'
import { runReminders } from '../services/reminders'

const router = Router()
router.use(authMiddleware, requireRole(MANAGEMENT_ROLES))

router.post('/run-reminders', async (req, res, next) => {
  try {
    const organizationId = organizationIdOf(req)
    const result = await runReminders(new Date(), { organizationIds: [organizationId] })
    res.json({ success: true, data: result, message: 'Reminder run completed' })
  } catch (error) {
    next(error)
  }
})

export default router
