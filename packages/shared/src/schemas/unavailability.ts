import { z } from 'zod'
import { isoDateSchema } from './common'

const adminFields = z.object({
  doctorId: z.number().int().positive(),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
})

const selfFields = adminFields.omit({ doctorId: true })

export const createUnavailabilityAdminSchema = adminFields.refine(
  (d) => d.endDate >= d.startDate,
  {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  },
)

export const createUnavailabilitySelfSchema = selfFields.refine(
  (d) => d.endDate >= d.startDate,
  {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  },
)

export const updateUnavailabilitySchema = z
  .object({
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
  })
  .refine((d) => !(d.startDate && d.endDate && d.endDate < d.startDate), {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  })

export const unavailabilityQuerySchema = z.object({
  doctorId: z.coerce.number().int().positive().optional(),
  clinicId: z.coerce.number().int().positive().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
})
