import type { AuthUser, OpenDutySettings, UpdateOpenDutyRequest } from '@oncall/shared'
import {
  DEFAULT_OPEN_DUTY_ANCHOR_DATE,
  DEFAULT_OPEN_DUTY_INTERVAL_DAYS,
  isoDateSchema,
} from '@oncall/shared'
import { query } from '../db/client'
import { logActivity } from './activity.service'

type Actor = Pick<AuthUser, 'id' | 'role'>

const INTERVAL_KEY = 'open_duty_interval_days'
const ANCHOR_KEY = 'open_duty_anchor_date'

/**
 * The open/closed cycle lives in app_meta so administrators can tune it
 * without a redeploy. Missing or corrupt rows fall back to the seeded
 * defaults instead of breaking schedule rendering.
 */
export async function getOpenDutySettings(): Promise<OpenDutySettings> {
  const res = await query<{ key: string; value: string }>(
    'SELECT key, value FROM app_meta WHERE key IN ($1, $2)',
    [ANCHOR_KEY, INTERVAL_KEY],
  )
  const anchor = res.rows.find((r) => r.key === ANCHOR_KEY)?.value
  const interval = Number.parseInt(res.rows.find((r) => r.key === INTERVAL_KEY)?.value ?? '', 10)
  return {
    intervalDays:
      Number.isInteger(interval) && interval >= 1 ? interval : DEFAULT_OPEN_DUTY_INTERVAL_DAYS,
    anchorDate:
      anchor && isoDateSchema.safeParse(anchor).success ? anchor : DEFAULT_OPEN_DUTY_ANCHOR_DATE,
  }
}

export async function setOpenDutyInterval(
  input: UpdateOpenDutyRequest,
  actor: Actor,
): Promise<OpenDutySettings> {
  const previous = await getOpenDutySettings()
  await query(
    `INSERT INTO app_meta (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [INTERVAL_KEY, String(input.intervalDays)],
  )
  await logActivity({
    userId: actor.id,
    action: 'open_duty_settings.updated',
    entityType: 'open_duty_settings',
    entityId: null,
    detail: { previousIntervalDays: previous.intervalDays, intervalDays: input.intervalDays },
  })
  return getOpenDutySettings()
}
