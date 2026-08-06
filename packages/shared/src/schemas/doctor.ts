import { z } from 'zod'

export const createDoctorSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  maxMonthlyDuties: z.number().int().min(1).max(7).default(7),
})

export const updateDoctorSchema = z.object({
  email: z.string().email().optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  maxMonthlyDuties: z.number().int().min(1).max(7).optional(),
  isActive: z.boolean().optional(),
})
