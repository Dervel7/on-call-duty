import { z } from 'zod'
import { isoDateSchema, idSchema } from './common.ts'

export const ACTIVITY_ACTIONS = [
  'auth.login',
  'auth.logout',
  'auth.password_changed',
  'user.created',
  'user.updated',
  'user.password_reset',
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
  'holidays.updated',
  'schedule.generated',
  'schedule.published',
  'schedule.reverted',
  'schedule.deleted',
  'duty.assigned',
  'duty.reassigned',
  'duty.removed',
  'billing.updated',
  'open_duty_settings.updated',
  'duty_slots_settings.updated',
  'duty_minimums_settings.updated',
] as const

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number]

export const activityQuerySchema = z.object({
  action: z.enum(ACTIVITY_ACTIONS).optional(),
  userId: idSchema.optional(),
  clinicId: idSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: 'from must not be after to',
    path: ['to'],
  })
