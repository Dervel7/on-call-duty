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

/** Seeded defaults for the per-day on-call slot counts; fallback when missing/corrupt. */
export const DEFAULT_OPEN_DUTY_SLOTS = 2
export const DEFAULT_CLOSED_DUTY_SLOTS = 2

export const updateDutySlotsSchema = z.object({
  openDutySlots: z.coerce.number().int().min(1).max(7),
  closedDutySlots: z.coerce.number().int().min(1).max(7),
})

export const updateOpenDutySchema = z.object({
  intervalDays: z.coerce.number().int().min(1).max(365),
})
