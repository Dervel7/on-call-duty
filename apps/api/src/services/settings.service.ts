import type {
  AuthUser,
  DutyMinimumSettings,
  DutySlotsSettings,
  OpenDutySettings,
  UpdateDutyMinimumsRequest,
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
import { HttpError } from '../lib/http-error'
import { logActivity } from './activity.service'

type Actor = Pick<AuthUser, 'id' | 'role'>

const INTERVAL_KEY = 'open_duty_interval_days'
const ANCHOR_KEY = 'open_duty_anchor_date'
const OPEN_SLOTS_KEY = 'open_duty_slots'
const CLOSED_SLOTS_KEY = 'closed_duty_slots'
const OPEN_MINIMUM_KEY = 'open_duty_minimum'
const CLOSED_MINIMUM_KEY = 'closed_duty_minimum'

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
  // Slots may never drop below a minimum the administrator set explicitly.
  // Unset minimums follow the slot count, so they never block a change.
  const stored = await readStoredMinimums()
  const blocked: string[] = []
  if (stored.open !== null && input.openDutySlots < stored.open)
    blocked.push(`open minimum is ${stored.open}`)
  if (stored.closed !== null && input.closedDutySlots < stored.closed)
    blocked.push(`closed minimum is ${stored.closed}`)
  if (blocked.length > 0)
    throw new HttpError(
      409,
      `On-call slots cannot be lower than the minimum on-call doctors (${blocked.join(', ')}); lower the minimums first`,
    )
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

/** Stored minimums; null where the row is missing or corrupt. */
async function readStoredMinimums(): Promise<{ open: number | null; closed: number | null }> {
  const res = await query<{ key: string; value: string }>(
    'SELECT key, value FROM app_meta WHERE key IN ($1, $2)',
    [OPEN_MINIMUM_KEY, CLOSED_MINIMUM_KEY],
  )
  const parse = (key: string): number | null => {
    const n = Number.parseInt(res.rows.find((r) => r.key === key)?.value ?? '', 10)
    return Number.isInteger(n) && n >= 1 ? n : null
  }
  return { open: parse(OPEN_MINIMUM_KEY), closed: parse(CLOSED_MINIMUM_KEY) }
}

/**
 * Hard minimum of on-call doctors per day type. Missing or corrupt rows fall
 * back to the slot count (full coverage), and a stored value above the slot
 * count is clamped to it, so consumers always see 1 ≤ minimum ≤ slots.
 */
export async function getDutyMinimums(): Promise<DutyMinimumSettings> {
  const [slots, stored] = await Promise.all([getDutySlots(), readStoredMinimums()])
  return {
    openDutyMinimum: Math.min(stored.open ?? slots.openDutySlots, slots.openDutySlots),
    closedDutyMinimum: Math.min(stored.closed ?? slots.closedDutySlots, slots.closedDutySlots),
  }
}

export async function setDutyMinimums(
  input: UpdateDutyMinimumsRequest,
  actor: Actor,
): Promise<DutyMinimumSettings> {
  const [slots, previous] = await Promise.all([getDutySlots(), getDutyMinimums()])
  const blocked: string[] = []
  if (input.openDutyMinimum > slots.openDutySlots)
    blocked.push(`open days have ${slots.openDutySlots}`)
  if (input.closedDutyMinimum > slots.closedDutySlots)
    blocked.push(`closed days have ${slots.closedDutySlots}`)
  if (blocked.length > 0)
    throw new HttpError(
      409,
      `Minimum on-call doctors cannot exceed the on-call slots (${blocked.join(', ')}); raise the slots first`,
    )
  await query(
    `INSERT INTO app_meta (key, value) VALUES ($1, $2), ($3, $4)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [
      OPEN_MINIMUM_KEY,
      String(input.openDutyMinimum),
      CLOSED_MINIMUM_KEY,
      String(input.closedDutyMinimum),
    ],
  )
  await logActivity({
    userId: actor.id,
    action: 'duty_minimums_settings.updated',
    entityType: 'duty_minimums_settings',
    entityId: null,
    detail: {
      previousOpenDutyMinimum: previous.openDutyMinimum,
      previousClosedDutyMinimum: previous.closedDutyMinimum,
      openDutyMinimum: input.openDutyMinimum,
      closedDutyMinimum: input.closedDutyMinimum,
    },
  })
  return getDutyMinimums()
}
