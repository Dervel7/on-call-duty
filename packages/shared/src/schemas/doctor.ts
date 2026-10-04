import { z } from 'zod'
import { passwordSchema } from './common'
import { personNameSchema, usernameSchema } from './auth'

export const createDoctorSchema = z.object({
  email: z.string().email(),
  username: usernameSchema,
  password: passwordSchema,
  firstName: personNameSchema,
  lastName: personNameSchema,
  maxMonthlyDuties: z.number().int().min(1).max(7).default(7),
})

export const updateDoctorSchema = z.object({
  email: z.string().email().optional(),
  username: usernameSchema.optional(),
  firstName: personNameSchema.optional(),
  lastName: personNameSchema.optional(),
  maxMonthlyDuties: z.number().int().min(1).max(7).optional(),
  isActive: z.boolean().optional(),
})
