import { z } from 'zod'

export { createDoctorSchema, updateDoctorSchema } from '@oncall/shared'
export { idParams } from './user'

export const doctorQuerySchema = z.object({
  clinicId: z.coerce.number().int().positive().optional(),
})
