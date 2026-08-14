import { z } from 'zod'

export const roleSchema = z.enum(['administrator', 'doctor', 'superadmin'])

export const usernameSchema = z.string().regex(/^[A-Za-z0-9._-]{3,32}$/, 'Invalid username')

export const loginSchema = z.object({
  identifier: z.string().min(1),
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
  username: usernameSchema,
  password: z.string().min(6),
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
