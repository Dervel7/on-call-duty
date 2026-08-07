import { z } from 'zod'

const unavailabilityTypeEnum = z.enum(['vacation', 'sick', 'conference', 'other'])
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date (YYYY-MM-DD)')

const adminFields = z.object({
  doctorId: z.number().int().positive(),
  type: unavailabilityTypeEnum,
  startDate: dateStr,
  endDate: dateStr,
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
    startDate: dateStr.optional(),
    endDate: dateStr.optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .refine((d) => !(d.startDate && d.endDate && d.endDate < d.startDate), {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  })

export const unavailabilityQuerySchema = z.object({
  doctorId: z.coerce.number().int().positive().optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
})
