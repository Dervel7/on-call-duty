import { z } from 'zod'
import { isoDateSchema } from './common'

/** Shown verbatim to locked-out users; the client surfaces it unchanged. */
export const SYSTEM_LOCKED_MESSAGE = 'System locked. Contact your service provider.'

export const updateBillingSchema = z.object({
  paidThrough: isoDateSchema,
})

/** Seeded defaults; used when the app_meta rows are missing or corrupt. */
export const DEFAULT_OPEN_DUTY_ANCHOR_DATE = '2026-10-02'
export const DEFAULT_OPEN_DUTY_INTERVAL_DAYS = 8

export const updateOpenDutySchema = z.object({
  intervalDays: z.coerce.number().int().min(1).max(365),
})
