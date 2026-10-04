import type {
  AuthUser,
  ClinicDutySlots,
  DutyMinimumSettings,
  DutySlotsSettings,
  OpenDutySettings,
  UpdateDutyMinimumsRequest,
  UpdateDutySlotsRequest,
  UpdateOpenDutyRequest,
} from '@oncall/shared'
import {
  DEFAULT_OPEN_DUTY_ANCHOR_DATE,
  DEFAULT_OPEN_DUTY_INTERVAL_DAYS,
  isoDateSchema,
} from '@oncall/shared'
import { query } from '../db/client'
import { HttpError } from '../lib/http-error'
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

/** Per-day on-call capacity of one clinic, split by day type (clinics columns). */
export async function getDutySlots(clinicId: number): Promise<DutySlotsSettings> {
  const res = await query<{
    open_duty_slots: number
    post_open_duty_slots: number
    closed_duty_slots: number
  }>(
    'SELECT open_duty_slots, post_open_duty_slots, closed_duty_slots FROM clinics WHERE id = $1',
    [clinicId],
  )
  const row = res.rows[0]
  if (!row) throw new HttpError(404, 'Clinic not found')
  return {
    openDutySlots: row.open_duty_slots,
    postOpenDutySlots: row.post_open_duty_slots,
    closedDutySlots: row.closed_duty_slots,
  }
}

/**
 * The clinic's slot counts plus its active doctor count. Active doctors are
 * the engine's candidate pool, so that count is the ceiling for every slot.
 */
export async function getClinicDutySlots(clinicId: number): Promise<ClinicDutySlots> {
  const res = await query<{
    open_duty_slots: number
    post_open_duty_slots: number
    closed_duty_slots: number
    active_doctors: number
  }>(
    `SELECT c.open_duty_slots, c.post_open_duty_slots, c.closed_duty_slots,
       (SELECT COUNT(*)::int FROM doctors d JOIN users u ON u.id = d.user_id
        WHERE d.clinic_id = c.id AND u.is_active = TRUE) AS active_doctors
     FROM clinics c WHERE c.id = $1`,
    [clinicId],
  )
  const row = res.rows[0]
  if (!row) throw new HttpError(404, 'Clinic not found')
  return {
    openDutySlots: row.open_duty_slots,
    postOpenDutySlots: row.post_open_duty_slots,
    closedDutySlots: row.closed_duty_slots,
    activeDoctors: row.active_doctors,
  }
}

/**
 * Each count must stay between the clinic's matching minimum and its active
 * doctor count.
 */
export async function setDutySlots(
  input: UpdateDutySlotsRequest,
  actor: Actor,
  clinicId: number,
): Promise<ClinicDutySlots> {
  const [previous, minimums] = await Promise.all([
    getClinicDutySlots(clinicId),
    getDutyMinimums(clinicId),
  ])
  const max = previous.activeDoctors
  if (
    input.openDutySlots > max ||
    input.postOpenDutySlots > max ||
    input.closedDutySlots > max
  ) {
    throw new HttpError(
      422,
      `On-call slots cannot exceed the clinic's ${max} active doctor${max === 1 ? '' : 's'}`,
    )
  }
  // Slots may never drop below the minimum on-call doctors of the same day type.
  const blocked: string[] = []
  if (input.openDutySlots < minimums.openDutyMinimum)
    blocked.push(`open minimum is ${minimums.openDutyMinimum}`)
  if (input.postOpenDutySlots < minimums.postOpenDutyMinimum)
    blocked.push(`day-after-open minimum is ${minimums.postOpenDutyMinimum}`)
  if (input.closedDutySlots < minimums.closedDutyMinimum)
    blocked.push(`closed minimum is ${minimums.closedDutyMinimum}`)
  if (blocked.length > 0)
    throw new HttpError(
      409,
      `On-call slots cannot be lower than the minimum on-call doctors (${blocked.join(', ')}); lower the minimums first`,
    )
  await query(
    `UPDATE clinics
     SET open_duty_slots = $2, post_open_duty_slots = $3, closed_duty_slots = $4, updated_at = NOW()
     WHERE id = $1`,
    [clinicId, input.openDutySlots, input.postOpenDutySlots, input.closedDutySlots],
  )
  await logActivity({
    userId: actor.id,
    action: 'duty_slots_settings.updated',
    entityType: 'duty_slots_settings',
    entityId: null,
    clinicId,
    detail: {
      previousOpenDutySlots: previous.openDutySlots,
      previousPostOpenDutySlots: previous.postOpenDutySlots,
      previousClosedDutySlots: previous.closedDutySlots,
      openDutySlots: input.openDutySlots,
      postOpenDutySlots: input.postOpenDutySlots,
      closedDutySlots: input.closedDutySlots,
    },
  })
  return getClinicDutySlots(clinicId)
}

/**
 * Hard minimum of on-call doctors per day type for one clinic. A stored value
 * above the slot count is clamped to it, so consumers always see
 * 1 ≤ minimum ≤ slots.
 */
export async function getDutyMinimums(clinicId: number): Promise<DutyMinimumSettings> {
  const res = await query<{
    open_duty_slots: number
    post_open_duty_slots: number
    closed_duty_slots: number
    open_duty_minimum: number
    post_open_duty_minimum: number
    closed_duty_minimum: number
  }>(
    `SELECT open_duty_slots, post_open_duty_slots, closed_duty_slots,
       open_duty_minimum, post_open_duty_minimum, closed_duty_minimum
     FROM clinics WHERE id = $1`,
    [clinicId],
  )
  const row = res.rows[0]
  if (!row) throw new HttpError(404, 'Clinic not found')
  return {
    openDutyMinimum: Math.min(row.open_duty_minimum, row.open_duty_slots),
    postOpenDutyMinimum: Math.min(row.post_open_duty_minimum, row.post_open_duty_slots),
    closedDutyMinimum: Math.min(row.closed_duty_minimum, row.closed_duty_slots),
  }
}

export async function setDutyMinimums(
  input: UpdateDutyMinimumsRequest,
  actor: Actor,
  clinicId: number,
): Promise<DutyMinimumSettings> {
  const [slots, previous] = await Promise.all([
    getDutySlots(clinicId),
    getDutyMinimums(clinicId),
  ])
  const blocked: string[] = []
  if (input.openDutyMinimum > slots.openDutySlots)
    blocked.push(`open days have ${slots.openDutySlots}`)
  if (input.postOpenDutyMinimum > slots.postOpenDutySlots)
    blocked.push(`days after open have ${slots.postOpenDutySlots}`)
  if (input.closedDutyMinimum > slots.closedDutySlots)
    blocked.push(`closed days have ${slots.closedDutySlots}`)
  if (blocked.length > 0)
    throw new HttpError(
      409,
      `Minimum on-call doctors cannot exceed the on-call slots (${blocked.join(', ')}); raise the slots first`,
    )
  await query(
    `UPDATE clinics
     SET open_duty_minimum = $2, post_open_duty_minimum = $3, closed_duty_minimum = $4,
       updated_at = NOW()
     WHERE id = $1`,
    [clinicId, input.openDutyMinimum, input.postOpenDutyMinimum, input.closedDutyMinimum],
  )
  await logActivity({
    userId: actor.id,
    action: 'duty_minimums_settings.updated',
    entityType: 'duty_minimums_settings',
    entityId: null,
    clinicId,
    detail: {
      previousOpenDutyMinimum: previous.openDutyMinimum,
      previousPostOpenDutyMinimum: previous.postOpenDutyMinimum,
      previousClosedDutyMinimum: previous.closedDutyMinimum,
      openDutyMinimum: input.openDutyMinimum,
      postOpenDutyMinimum: input.postOpenDutyMinimum,
      closedDutyMinimum: input.closedDutyMinimum,
    },
  })
  return getDutyMinimums(clinicId)
}
