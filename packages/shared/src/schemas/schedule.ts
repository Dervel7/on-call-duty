import { z } from 'zod'
import { isoDateSchema, queryIdSchema } from './common'

const yearMonth = {
  year: z.number().int().min(1970).max(2100),
  month: z.number().int().min(1).max(12),
}

export const createScheduleSchema = z.object(yearMonth)
export const scheduleQuerySchema = z.object({
  year: z.coerce.number().int().min(1970).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  clinicId: queryIdSchema.optional(),
})
export const createDutySchema = z.object({
  date: isoDateSchema,
  doctorId: z.number().int().positive().max(2_147_483_647),
})
export const reassignDutySchema = z.object({
  doctorId: z.number().int().positive().max(2_147_483_647),
})

export const generateScheduleSchema = createScheduleSchema.extend({
  assignments: z
    .array(
      z.object({
        date: isoDateSchema,
        doctorId: z.number().int().positive(),
        reason: z.string().max(500).optional(),
      }),
    )
    .optional(),
})
