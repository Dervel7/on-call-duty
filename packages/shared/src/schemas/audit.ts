import { z } from 'zod'
import { isoDateSchema } from './common'

export const ACTIVITY_ACTIONS = [
  'auth.login',
  'auth.logout',
  'auth.password_changed',
  'user.created',
  'user.updated',
  'user.deactivated',
  'user.reactivated',
  'user.deleted',
  'doctor.created',
  'doctor.updated',
  'doctor.deactivated',
  'doctor.reactivated',
  'doctor.deleted',
  'availability.created',
  'availability.updated',
  'availability.deleted',
  'holiday.created',
  'holiday.updated',
  'holiday.deleted',
  'schedule.generated',
  'schedule.published',
  'schedule.reverted',
  'schedule.deleted',
  'duty.assigned',
  'duty.reassigned',
  'duty.removed',
  'billing.updated',
] as const

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number]

export const activityQuerySchema = z.object({
  action: z.enum(ACTIVITY_ACTIONS).optional(),
  userId: z.coerce.number().int().positive().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
