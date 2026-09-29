import { z } from 'zod'
import { isoDateSchema } from './common'

export const holidayQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  clinicId: z.coerce.number().int().positive().optional(),
})

export const setMonthHolidaysSchema = z
  .object({
    year: z.number().int().min(2000).max(2100),
    month: z.number().int().min(1).max(12),
    dates: z.array(isoDateSchema),
  })
  .refine(
    (d) =>
      d.dates.every((date) => date.startsWith(`${d.year}-${String(d.month).padStart(2, '0')}-`)),
    {
      message: 'dates must fall inside the given year and month',
      path: ['dates'],
    },
  )
