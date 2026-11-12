import type { Actor, CreateDutyRequest, Duty, ReassignDutyRequest } from '@oncall/shared'
import type { PoolClient } from 'pg'
import { query, withTransaction } from '../db/client.ts'
import { HttpError } from '../lib/http-error.ts'
import {
  assignmentViolation,
  inMonth,
  isWeekendISO,
  minimumForDate,
  isCriticalDate,
  slotsForDate,
} from '../scheduling/index.ts'
import { recordActivity } from './activity.service.ts'
import {
  assertScheduleVisible,
  selectScheduleRow,
  SELECT_DUTY,
  toDuty,
  type DutyRow,
  type ScheduleRow,
} from './schedule-rows.ts'
import { buildContext } from './scheduling-context.ts'
import { getDutyMinimums, getOpenDutySettings } from './settings.service.ts'

async function getDutyRow(id: number): Promise<DutyRow> {
  const res = await query<DutyRow>(`${SELECT_DUTY} WHERE du.id = $1`, [id])
  const row = res.rows[0]
  if (!row) throw new HttpError(404, 'Duty not found')
  return row
}

async function getDutyById(id: number): Promise<Duty> {
  return toDuty(await getDutyRow(id))
}

/** Assert the duty's schedule is visible to the actor, returning the row. */
async function getVisibleDuty(dutyId: number, actor: Actor): Promise<DutyRow> {
  const duty = await getDutyRow(dutyId)
  assertScheduleVisible(duty.schedule_clinic_id, actor)
  return duty
}

/**
 * Checks a manual edit against every hard rule. Called after the schedule
 * row is locked, so a competing edit of the same month has either finished
 * (and is read here) or waits. `excludeDutyId` is the duty being replaced;
 * a new duty (null) also needs a free slot on its day.
 */
async function assertAssignable(
  schedule: Pick<ScheduleRow, 'id' | 'year' | 'month' | 'clinic_id'>,
  doctorId: number,
  date: string,
  excludeDutyId: number | null,
): Promise<void> {
  const ctx = await buildContext(schedule.year, schedule.month, schedule.clinic_id)
  if (!ctx.doctors.some((d) => d.id === doctorId)) {
    // The doctor must belong to the schedule's clinic: unknown and cross-clinic
    // doctors are the same 404 (isolation I9).
    const dr = await query(
      'SELECT 1 FROM doctors WHERE id = $1 AND clinic_id = $2',
      [doctorId, schedule.clinic_id],
    )
    if (dr.rows.length === 0) throw new HttpError(404, 'Doctor not found')
    throw new HttpError(409, 'Constraint violation: doctor inactive')
  }
  const held = await query<{ duty_date: string; doctor_id: number }>(
    `SELECT duty_date::text AS duty_date, doctor_id FROM duties
     WHERE schedule_id = $1 AND ($2::int IS NULL OR id <> $2)`,
    [schedule.id, excludeDutyId],
  )
  const duties = held.rows.map((r) => ({ date: r.duty_date, doctorId: r.doctor_id }))
  if (excludeDutyId === null) {
    const slots = slotsForDate(date, ctx.openDuty, ctx.slots)
    if (duties.filter((d) => d.date === date).length >= slots)
      throw new HttpError(409, `All ${slots} on-call slots for this date are already filled`)
  }
  const violation = assignmentViolation(ctx, duties, { date, doctorId })
  if (violation) throw new HttpError(409, `Constraint violation: ${violation}`)
}

export function assertEditable(
  status: string,
  message = 'Schedule is published; revert to draft to edit',
): void {
  if (status === 'published') throw new HttpError(409, message)
}

/** Locks the schedule row and enforces draft-only edits inside the caller's transaction. */
export async function lockScheduleForEdit(client: PoolClient, scheduleId: number): Promise<void> {
  const res = await client.query<{ status: string }>('SELECT status FROM schedules WHERE id = $1 FOR UPDATE', [
    scheduleId,
  ])
  if (res.rows.length === 0) throw new HttpError(404, 'Schedule not found')
  assertEditable(res.rows[0]!.status)
}

export async function addDuty(
  scheduleId: number,
  input: CreateDutyRequest,
  actor: Actor,
): Promise<Duty> {
  const schedule = await selectScheduleRow(scheduleId)
  assertScheduleVisible(schedule.clinic_id, actor)
  if (!inMonth(input.date, schedule.year, schedule.month))
    throw new HttpError(400, 'Date is outside this schedule month')

  assertEditable(schedule.status)

  const reason = `manual override by admin #${actor.id}`
  const id = await withTransaction(async (client) => {
    await lockScheduleForEdit(client, scheduleId)
    await assertAssignable(schedule, input.doctorId, input.date, null)
    const ins = await client.query<{ id: number }>(
      `INSERT INTO duties (schedule_id, duty_date, doctor_id, is_weekend, reason)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [scheduleId, input.date, input.doctorId, isWeekendISO(input.date), reason],
    )
    const newId = ins.rows[0]?.id
    if (newId === undefined) throw new HttpError(500, 'Failed to create duty')
    await recordActivity(client, {
      userId: actor.id,
      action: 'duty.assigned',
      entityType: 'duty',
      entityId: newId,
      clinicId: schedule.clinic_id,
      detail: { scheduleId, date: input.date, doctorId: input.doctorId },
    })
    return newId
  })
  return getDutyById(id)
}

export async function reassignDuty(
  dutyId: number,
  input: ReassignDutyRequest,
  actor: Actor,
): Promise<Duty> {
  const duty = await getVisibleDuty(dutyId, actor)
  assertEditable(duty.schedule_status)
  const reason = `manual override by admin #${actor.id}`
  await withTransaction(async (client) => {
    await lockScheduleForEdit(client, duty.schedule_id)
    await assertAssignable(
      {
        id: duty.schedule_id,
        year: duty.schedule_year,
        month: duty.schedule_month,
        clinic_id: duty.schedule_clinic_id,
      },
      input.doctorId,
      duty.duty_date,
      dutyId,
    )
    const res = await client.query(
      'UPDATE duties SET doctor_id = $1, reason = $2 WHERE id = $3 RETURNING id',
      [input.doctorId, reason, dutyId],
    )
    // The duty may have been removed between the read above and the lock.
    if (res.rows.length === 0) throw new HttpError(404, 'Duty not found')
    await recordActivity(client, {
      userId: actor.id,
      action: 'duty.reassigned',
      entityType: 'duty',
      entityId: dutyId,
      clinicId: duty.schedule_clinic_id,
      detail: {
        scheduleId: duty.schedule_id,
        date: duty.duty_date,
        fromDoctorId: duty.doctor_id,
        toDoctorId: input.doctorId,
      },
    })
  })
  return getDutyById(dutyId)
}

export async function removeDuty(dutyId: number, actor: Actor): Promise<void> {
  const duty = await getVisibleDuty(dutyId, actor)
  assertEditable(duty.schedule_status)
  // Strict rule: an open on-call day and the day after it never drop below
  // their minimum through a removal - such a duty must be reassigned instead.
  // The count is read under the schedule lock so concurrent removals cannot
  // both pass.
  const [openDuty, minimums] = await Promise.all([
    getOpenDutySettings(),
    getDutyMinimums(duty.schedule_clinic_id),
  ])
  const minimum = minimumForDate(duty.duty_date, openDuty, minimums)
  await withTransaction(async (client) => {
    await lockScheduleForEdit(client, duty.schedule_id)
    if (isCriticalDate(duty.duty_date, openDuty)) {
      const res = await client.query<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM duties WHERE schedule_id = $1 AND duty_date = $2',
        [duty.schedule_id, duty.duty_date],
      )
      if ((res.rows[0]?.n ?? 0) - 1 < minimum)
        throw new HttpError(
          409,
          `Open on-call rule: ${duty.duty_date} (an open on-call day or the day after one) must keep at least ${minimum} doctors; reassign the duty instead of removing it`,
        )
    }
    const res = await client.query('DELETE FROM duties WHERE id = $1 RETURNING id', [dutyId])
    if (res.rows.length === 0) throw new HttpError(404, 'Duty not found')
    await recordActivity(client, {
      userId: actor.id,
      action: 'duty.removed',
      entityType: 'duty',
      entityId: dutyId,
      clinicId: duty.schedule_clinic_id,
      detail: { scheduleId: duty.schedule_id, date: duty.duty_date, doctorId: duty.doctor_id },
    })
  })
}
