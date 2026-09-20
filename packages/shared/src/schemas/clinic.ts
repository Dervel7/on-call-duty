import { z } from 'zod'

const clinicName = z.string().trim().min(2).max(80)

export const createClinicSchema = z.object({
  name: clinicName,
})

export const updateClinicSchema = z
  .object({
    name: clinicName.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((d) => d.name !== undefined || d.isActive !== undefined, {
    message: 'At least one field is required',
  })
