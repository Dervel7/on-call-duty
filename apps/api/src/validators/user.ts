import { z } from 'zod'

export { createUserSchema, resetUserPasswordSchema, updateThemeSchema, updateUserSchema } from '@oncall/shared'

export const idParams = z.object({ id: z.coerce.number().int().positive() })

export const userQuerySchema = z.object({
  clinicId: z.coerce.number().int().positive().optional(),
})
