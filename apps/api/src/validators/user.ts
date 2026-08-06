import { z } from 'zod'

export { createUserSchema, updateUserSchema } from '@oncall/shared'

export const idParams = z.object({ id: z.coerce.number().int().positive() })
