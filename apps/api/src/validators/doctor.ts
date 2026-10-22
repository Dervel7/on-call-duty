import { z } from 'zod'

export { createDoctorSchema, updateDoctorSchema } from '@oncall/shared'
export { idParams } from './user.ts'

export const doctorQuerySchema = z.object({
  clinicId: z.coerce.number().int().positive().optional(),
})
