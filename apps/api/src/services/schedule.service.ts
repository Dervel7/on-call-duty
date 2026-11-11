import type {
  Actor,
  Duty,
  GenerateAssignment,
  ScheduleDetail,
  ScheduleQuery,
  ScheduleSummary,
} from '@oncall/shared'
import { query, withTransaction } from '../db/client.ts'
import { HttpError } from '../lib/http-error.ts'
import type { ClinicScope } from '../lib/scope.ts'
import { daysInMonth, isWeekendISO, isoDate, minimumForDate } from '../scheduling/index.ts'
import { recordGeneration } from './usage.service.ts'
import { recordActivity } from './activity.service.ts'
import { assertEditable, lockScheduleForEdit } from './duty.service.ts'
import { validatePlan } from './schedule-rules.ts'
import {
  assertNoSchedule,
  assertScheduleVisible,
  selectScheduleRow,
  SELECT_DUTY,
  SELECT_SCHEDULE,
  toDuty,
  toSchedule,
  type DutyRow,
  type ScheduleRow,
} from './schedule-rows.ts'
import { buildContext, calendarDays, eligibilityFor } from './scheduling-context.ts'
import { getDutyMinimums, getDutySlots, getOpenDutySettings } from './settings.service.ts'

export async function generate(
  year: number,
  month: number,
  actor: Actor,
  scope: ClinicScope,
  assignments: GenerateAssignment[],
): Promise<ScheduleDetail> {
  await assertNoSchedule(year, month, scope.clinicId)

  const ctx = await buildContext(year, month, scope.clinicId)

  const planDuties = validatePlan(ctx, assignments)

  const scheduleId = await withTransaction(async (client) => {
    const ins = await client.query<{ id: number }>(
      `INSERT INTO schedules (clinic_id, year, month, status, created_by)
       VALUES ($1, $2, $3, 'draft', $4) RETURNING id`,
      [scope.clinicId, year, month, actor.id],
    )
    const id = ins.rows[0]?.id
    if (id === undefined) throw new HttpError(500, 'Failed to create schedule')
    for (const d of planDuties) {
      await client.query(
        `INSERT INTO duties (schedule_id, duty_date, doctor_id, is_weekend, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, d.date, d.doctorId, d.isWeekend, d.reason],
      )
    }
    const doctorIds = [...new Set(planDuties.map((d) => d.doctorId))]
    await recordGeneration(client, scope.clinicId, year, month, doctorIds)
    await recordActivity(client, {
      userId: actor.id,
      action: 'schedule.generated',
      entityType: 'schedule',
      entityId: id,
      clinicId: scope.clinicId,
      detail: {
        year,
        month,
        dutyCount: planDuties.length,
        doctorCount: doctorIds.length,
      },
    })
    return id
  })
  return getById(scheduleId, actor)
}

export async function list(
  filters: ScheduleQuery,
  actor: Actor,
  scope: ClinicScope,
): Promise<ScheduleSummary[]> {
  const params: unknown[] = [scope.clinicId]
  const where: string[] = ['s.clinic_id = $1']
  // Only administrators and superadmins see drafts; getById enforces the same rule.
  if (actor.role !== 'administrator' && actor.role !== 'superadmin') {
    params.push('published')
    where.push(`s.status = $${params.length}`)
  }
  if (filters.year !== undefined) {
    params.push(filters.year)
    where.push(`s.year = $${params.length}`)
  }
  if (filters.month !== undefined) {
    params.push(filters.month)
    where.push(`s.month = $${params.length}`)
  }
  const res = await query<ScheduleRow>(
    `${SELECT_SCHEDULE} WHERE ${where.join(' AND ')} ORDER BY s.year DESC, s.month DESC`,
    params,
  )
  return res.rows.map(toSchedule)
}

export async function listDutiesBySchedule(scheduleId: number): Promise<Duty[]> {
  const res = await query<DutyRow>(
    `${SELECT_DUTY} WHERE du.schedule_id = $1 ORDER BY du.duty_date, du.id`,
    [scheduleId],
  )
  return res.rows.map(toDuty)
}

export async function getScheduleDuties(
  id: number,
  actor: Actor,
): Promise<{ schedule: ScheduleSummary; duties: Duty[] }> {
  const schedule = await selectScheduleRow(id)
  assertScheduleVisible(schedule.clinic_id, actor)
  return { schedule: toSchedule(schedule), duties: await listDutiesBySchedule(id) }
}

export async function getById(id: number, actor: Actor): Promise<ScheduleDetail> {
  const { schedule, duties } = await getScheduleDuties(id, actor)
  const isAdmin = actor.role === 'administrator' || actor.role === 'superadmin'
  if (!isAdmin && schedule.status !== 'published') {
    throw new HttpError(403, 'Schedule not published')
  }
  if (!isAdmin) {
    // Calendar shape only — skip the eligibility work that gets blanked anyway.
    const [openDuty, slots, minimums] = await Promise.all([
      getOpenDutySettings(),
      getDutySlots(schedule.clinicId),
      getDutyMinimums(schedule.clinicId),
    ])
    const dates = Array.from({ length: daysInMonth(schedule.year, schedule.month) }, (_, i) =>
      isoDate(schedule.year, schedule.month, i + 1),
    )
    const days = calendarDays(
      dates.map((date) => ({ date, isWeekend: isWeekendISO(date) })),
      openDuty,
      slots,
      minimums,
    )
    return { schedule, duties, days }
  }
  const ctx = await buildContext(schedule.year, schedule.month, schedule.clinicId)
  const days = eligibilityFor(
    ctx,
    duties.map((d) => ({ date: d.dutyDate, doctorId: d.doctorId })),
  )
  return { schedule, duties, days }
}

export async function remove(id: number, actor: Actor): Promise<void> {
  const existing = await selectScheduleRow(id)
  assertScheduleVisible(existing.clinic_id, actor)
  assertEditable(existing.status, 'Schedule is published; revert to draft before deleting')
  await withTransaction(async (client) => {
    // Re-check under lock: a concurrent publish must not be deletable.
    await lockScheduleForEdit(client, id)
    await client.query('DELETE FROM schedules WHERE id = $1', [id])
    await recordActivity(client, {
      userId: actor.id,
      action: 'schedule.deleted',
      entityType: 'schedule',
      entityId: id,
      clinicId: existing.clinic_id,
      detail: { year: existing.year, month: existing.month },
    })
  })
}

export async function publish(id: number, actor: Actor): Promise<ScheduleSummary> {
  const existing = await selectScheduleRow(id)
  assertScheduleVisible(existing.clinic_id, actor)
  // Strict rule gate: every day must hold at least its minimum (open minimum
  // on open on-call days, closed minimum on all others). Settings are read
  // outside the transaction.
  const [openDuty, minimums] = await Promise.all([
    getOpenDutySettings(),
    getDutyMinimums(existing.clinic_id),
  ])
  await withTransaction(async (client) => {
    const upd = await client.query(
      `UPDATE schedules SET status = 'published', updated_at = NOW()
       WHERE id = $1 AND status = 'draft' RETURNING id`,
      [id],
    )
    if (upd.rows.length === 0) throw new HttpError(409, 'Schedule is already published')
    const duties = await client.query<{ duty_date: string; n: number }>(
      `SELECT duty_date::text AS duty_date, COUNT(*)::int AS n
       FROM duties WHERE schedule_id = $1 GROUP BY duty_date`,
      [id],
    )
    const byDate = new Map(duties.rows.map((r) => [r.duty_date, r.n]))
    if (byDate.size < daysInMonth(existing.year, existing.month))
      throw new HttpError(409, 'Schedule is incomplete; every day needs at least one duty before publishing')
    const total = daysInMonth(existing.year, existing.month)
    const short: string[] = []
    for (let d = 1; d <= total; d++) {
      const date = isoDate(existing.year, existing.month, d)
      if ((byDate.get(date) ?? 0) < minimumForDate(date, openDuty, minimums)) short.push(date)
    }
    if (short.length > 0)
      throw new HttpError(
        409,
        `Minimum on-call rule: ${short.length} day(s) are below their minimum on-call doctors before publishing: ${short.join(', ')}`,
      )
    await recordActivity(client, {
      userId: actor.id,
      action: 'schedule.published',
      entityType: 'schedule',
      entityId: id,
      clinicId: existing.clinic_id,
      detail: {
        year: existing.year,
        month: existing.month,
        dutyCount: duties.rows.reduce((sum, r) => sum + r.n, 0),
      },
    })
  })
  return toSchedule(await selectScheduleRow(id))
}

export async function unpublish(id: number, actor: Actor): Promise<ScheduleSummary> {
  const existing = await selectScheduleRow(id)
  assertScheduleVisible(existing.clinic_id, actor)
  await withTransaction(async (client) => {
    const upd = await client.query(
      `UPDATE schedules SET status = 'draft', updated_at = NOW()
       WHERE id = $1 AND status = 'published' RETURNING id`,
      [id],
    )
    if (upd.rows.length === 0) throw new HttpError(409, 'Schedule is already draft')
    await recordActivity(client, {
      userId: actor.id,
      action: 'schedule.reverted',
      entityType: 'schedule',
      entityId: id,
      clinicId: existing.clinic_id,
      detail: { year: existing.year, month: existing.month },
    })
  })
  return toSchedule(await selectScheduleRow(id))
}
