import { z } from 'zod'

export const roleSchema = z.enum(['administrator', 'doctor'])

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(6),
    newPassword: z.string().min(6),
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: 'New password must differ',
  })

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: roleSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
})

export const updateUserSchema = z.object({
  email: z.string().email().optional(),
  role: roleSchema.optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
})
