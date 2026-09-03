import { z } from 'zod'
import { passwordSchema } from './common'

export const roleSchema = z.enum(['administrator', 'doctor', 'superadmin'])

export const usernameSchema = z.string().regex(/^[A-Za-z0-9._-]{3,32}$/, 'Invalid username')

export const loginSchema = z.object({
  identifier: z.string().min(1),
  password: passwordSchema,
})

export const changePasswordSchema = z
  .object({
    currentPassword: passwordSchema,
    newPassword: passwordSchema,
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: 'New password must differ',
  })

export const createUserSchema = z.object({
  email: z.string().email(),
  username: usernameSchema,
  password: passwordSchema,
  role: roleSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
})

export const updateUserSchema = z.object({
  email: z.string().email().optional(),
  username: usernameSchema.optional(),
  role: roleSchema.optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
})
