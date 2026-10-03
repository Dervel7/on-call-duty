import { z } from 'zod'
import { queryIdSchema } from './common'

export const statsQuerySchema = z.object({
  year: z.coerce.number().int().min(1970).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  clinicId: queryIdSchema.optional(),
})
