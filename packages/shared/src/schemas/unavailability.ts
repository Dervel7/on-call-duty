import { z } from 'zod'
import { isoDateSchema } from './common'

const unavailabilityTypeEnum = z.enum(['vacation', 'sick', 'conference', 'other'])


const adminFields = z.object({
  doctorId: z.number().int().positive(),
  type: unavailabilityTypeEnum,
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  note: z.string().max(500).optional(),
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
    type: unavailabilityTypeEnum.optional(),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .refine((d) => !(d.startDate && d.endDate && d.endDate < d.startDate), {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  })

export const unavailabilityQuerySchema = z.object({
  doctorId: z.coerce.number().int().positive().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
})
