import { z } from 'zod'
import { queryIdSchema } from '@oncall/shared'

export {
  createUserSchema,
  resetUserPasswordSchema,
  updateLanguageSchema,
  updateThemeSchema,
  updateUserSchema,
  updateUsernameSchema,
} from '@oncall/shared'

export const idParams = z.object({ id: queryIdSchema })

export const userQuerySchema = z.object({
  clinicId: queryIdSchema.optional(),
})
