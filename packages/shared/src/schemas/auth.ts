import { z } from 'zod'
import { passwordSchema } from './common.ts'

export const roleSchema = z.enum(['superadmin', 'manager', 'administrator', 'doctor'])
export const languageSchema = z.enum(['en', 'el'])

export const usernameSchema = z.string().regex(/^[A-Za-z0-9._-]{3,32}$/, 'Invalid username')

// Emails are matched case-insensitively, so they are stored lowercase.
export const emailSchema = z.string().trim().toLowerCase().email()

export const loginSchema = z.object({
  identifier: z.string().min(1).transform((v) => (v.includes('@') ? v.trim().toLowerCase() : v)),
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
export const resetUserPasswordSchema = z.object({
  newPassword: passwordSchema,
})

export const createUserSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
  role: roleSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  clinicId: z.number().int().positive().optional(),
})

export const updateUserSchema = z.object({
  email: emailSchema.optional(),
  username: usernameSchema.optional(),
  role: roleSchema.optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  clinicId: z.number().int().positive().optional(),
})

export const updateThemeSchema = z.object({
  darkMode: z.boolean(),
})
export const updateLanguageSchema = z.object({
  language: languageSchema,
})
export const updateUsernameSchema = z.object({
  username: usernameSchema,
})
