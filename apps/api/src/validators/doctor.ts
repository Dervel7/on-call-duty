import { z } from 'zod'
import { queryIdSchema } from '@oncall/shared'

export { createDoctorSchema, updateDoctorSchema } from '@oncall/shared'
export { idParams } from './user'

export const doctorQuerySchema = z.object({
  clinicId: queryIdSchema.optional(),
})
