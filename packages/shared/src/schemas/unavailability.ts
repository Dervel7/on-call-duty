import { z } from 'zod'
import { isoDateSchema, queryIdSchema } from './common'

const adminFields = z.object({
  doctorId: z.number().int().positive().max(2_147_483_647),
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

export const setUnavailabilityDisabledSchema = z.object({
  isDisabled: z.boolean(),
})

export const splitUnavailabilitySchema = z.object({
  segments: z.array(createUnavailabilitySelfSchema).min(1),
  isDisabled: z.boolean().optional(),
})

export const unavailabilityQuerySchema = z.object({
  doctorId: queryIdSchema.optional(),
  clinicId: queryIdSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
})
