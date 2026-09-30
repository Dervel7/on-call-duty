import type {
  AuthUser,
  DutySlotsSettings,
  OpenDutySettings,
  UpdateDutySlotsRequest,
  UpdateOpenDutyRequest,
} from '@oncall/shared'
import {
  DEFAULT_CLOSED_DUTY_SLOTS,
  DEFAULT_OPEN_DUTY_ANCHOR_DATE,
  DEFAULT_OPEN_DUTY_INTERVAL_DAYS,
  DEFAULT_OPEN_DUTY_SLOTS,
  isoDateSchema,
} from '@oncall/shared'
import { query } from '../db/client'
import { logActivity } from './activity.service'

type Actor = Pick<AuthUser, 'id' | 'role'>

const INTERVAL_KEY = 'open_duty_interval_days'
const ANCHOR_KEY = 'open_duty_anchor_date'
const OPEN_SLOTS_KEY = 'open_duty_slots'
const CLOSED_SLOTS_KEY = 'closed_duty_slots'

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

/**
 * Per-day on-call capacity, split by day type. Same resilience contract as
 * the cycle: missing or corrupt rows fall back to the seeded defaults.
 */
export async function getDutySlots(): Promise<DutySlotsSettings> {
  const res = await query<{ key: string; value: string }>(
    'SELECT key, value FROM app_meta WHERE key IN ($1, $2)',
    [OPEN_SLOTS_KEY, CLOSED_SLOTS_KEY],
  )
  const open = Number.parseInt(res.rows.find((r) => r.key === OPEN_SLOTS_KEY)?.value ?? '', 10)
  const closed = Number.parseInt(res.rows.find((r) => r.key === CLOSED_SLOTS_KEY)?.value ?? '', 10)
  return {
    openDutySlots: Number.isInteger(open) && open >= 1 ? open : DEFAULT_OPEN_DUTY_SLOTS,
    closedDutySlots: Number.isInteger(closed) && closed >= 1 ? closed : DEFAULT_CLOSED_DUTY_SLOTS,
  }
}

export async function setDutySlots(
  input: UpdateDutySlotsRequest,
  actor: Actor,
): Promise<DutySlotsSettings> {
  const previous = await getDutySlots()
  await query(
    `INSERT INTO app_meta (key, value) VALUES ($1, $2), ($3, $4)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [OPEN_SLOTS_KEY, String(input.openDutySlots), CLOSED_SLOTS_KEY, String(input.closedDutySlots)],
  )
  await logActivity({
    userId: actor.id,
    action: 'duty_slots_settings.updated',
    entityType: 'duty_slots_settings',
    entityId: null,
    detail: {
      previousOpenDutySlots: previous.openDutySlots,
      previousClosedDutySlots: previous.closedDutySlots,
      openDutySlots: input.openDutySlots,
      closedDutySlots: input.closedDutySlots,
    },
  })
  return getDutySlots()
}
