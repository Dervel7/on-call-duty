import { z } from 'zod'

/**
 * ISO calendar date (YYYY-MM-DD) that must also be a real day: the regex
 * alone accepts 2026-02-30, which would blow up in date math and Postgres.
 */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date (YYYY-MM-DD)')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
  }, 'Invalid calendar date')

/** bcrypt silently ignores password bytes past 72; reject those up front. */
export const passwordSchema = z
  .string()
  .min(6)
  .refine((s) => new TextEncoder().encode(s).length <= 72, 'Password must be at most 72 bytes')

/** Postgres INTEGER ceiling; larger ids would fail in the driver with a 500. */
export const idSchema = z.coerce.number().int().positive().max(2_147_483_647)

export const idParamsSchema = z.object({ id: idSchema })

/** Optional target clinic for clinic-scoped reads and writes. */
export const clinicQuerySchema = z.object({ clinicId: idSchema.optional() })
