import { z } from 'zod'
import { isoDateSchema } from './common'

/** Shown verbatim to locked-out users; the client surfaces it unchanged. */
export const SYSTEM_LOCKED_MESSAGE = 'System locked. Contact your service provider.'

export const updateBillingSchema = z.object({
  paidThrough: isoDateSchema,
})
