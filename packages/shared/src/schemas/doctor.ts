import { z } from 'zod'
import { passwordSchema } from './common.ts'
import { emailSchema, usernameSchema } from './auth.ts'

export const createDoctorSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  maxMonthlyDuties: z.number().int().min(1).max(7).default(7),
})

export const updateDoctorSchema = z.object({
  email: emailSchema.optional(),
  username: usernameSchema.optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  maxMonthlyDuties: z.number().int().min(1).max(7).optional(),
  isActive: z.boolean().optional(),
})
