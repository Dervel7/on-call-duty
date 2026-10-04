import type {
  AuthUser,
  CreateDutyRequest,
  DayInfo,
  Duty,
  DutyMinimumSettings,
  DutySlotsSettings,
  GenerateAssignment,
  OpenDutySettings,
  PreviewResult,
  ReassignDutyRequest,
  ScheduleDetail,
  ScheduleQuery,
  ScheduleSummary,
  ScheduleStatus,
} from '@oncall/shared'
import type { PoolClient } from 'pg'
import { query, withTransaction } from '../db/client'
import { HttpError } from '../lib/http-error'
import type { ClinicScope } from '../lib/scope'
 import {
  HOLIDAY_DUTY_CAP,
  OPEN_DUTY_DUTY_CAP,
   generate as runEngine,
   isAvailable,
   notConsecutive,
   underCap,
   underHolidayCap,
   underOpenDutyCap,
 } from '../scheduling'
import {
  daysInMonth,
  dayOfWeekISO,
  inMonth,
  isOpenDutyDate,
  isWeekendISO,
  isoDate,
  minimumForDate,
  nextDate,
  prevDate,
  requiresDoubleCoverage,
  slotsForDate,
} from '../scheduling/dates'
import type { DoctorSpec, GenerateResult, SchedulingContext } from '../scheduling/types'
import { recordGeneration } from './usage.service'
import { recordActivity } from './activity.service'
import { getDutyMinimums, getDutySlots, getOpenDutySettings } from './settings.service'

type Actor = Pick<AuthUser, 'id' | 'role' | 'clinicId'>

interface ScheduleRow {
  id: number
  year: number
  month: number
  status: string
  clinic_id: number
  clinic_name: string
  created_by: number | null
  created_at: Date
  updated_at: Date
}

interface DutyRow {
  id: number
  schedule_id: number
  schedule_year: number
  schedule_month: number
  schedule_clinic_id: number
  duty_date: string
  doctor_id: number
  first_name: string
  last_name: string
  is_weekend: boolean
  reason: string
  created_at: Date
  schedule_status: string
}

const SELECT_SCHEDULE = `SELECT s.id, s.year, s.month, s.status, s.clinic_id, c.name AS clinic_name,
  s.created_by, s.created_at, s.updated_at
  FROM schedules s JOIN clinics c ON c.id = s.clinic_id`
const SELECT_DUTY = `SELECT du.id, du.schedule_id, du.duty_date, du.doctor_id, du.is_weekend,
  du.reason, du.created_at, u.first_name, u.last_name,
  s.status AS schedule_status, s.year AS schedule_year, s.month AS schedule_month,
  s.clinic_id AS schedule_clinic_id
  FROM duties du JOIN doctors d ON d.id = du.doctor_id JOIN users u ON u.id = d.user_id
  JOIN schedules s ON s.id = du.schedule_id`

/**
 * Object-level access: administrator/doctor may only reach schedules of their
 * own clinic (mismatch → 404, existence hidden); manager and superadmin pass.
 */
function assertScheduleVisible(row: ScheduleRow, actor: Actor | undefined): void {
  if (
    actor &&
    (actor.role === 'administrator' || actor.role === 'doctor') &&
    row.clinic_id !== actor.clinicId
  ) {
    throw new HttpError(404, 'Schedule not found')
  }
}

async function selectScheduleRow(id: number): Promise<ScheduleRow> {
  const res = await query<ScheduleRow>(`${SELECT_SCHEDULE} WHERE s.id = $1`, [id])
  const row = res.rows[0]
  if (!row) throw new HttpError(404, 'Schedule not found')
  return row
}

function toSchedule(row: ScheduleRow): ScheduleSummary {
  return {
    id: row.id,
    year: row.year,
    month: row.month,
    status: row.status as ScheduleStatus,
    clinicId: row.clinic_id,
    clinicName: row.clinic_name,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function toDuty(row: DutyRow): Duty {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    dutyDate: row.duty_date,
    doctorId: row.doctor_id,
    doctorFirstName: row.first_name,
    doctorLastName: row.last_name,
    isWeekend: row.is_weekend,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
  }
}

function monthBounds(year: number, month: number): { first: string; last: string } {
  return { first: isoDate(year, month, 1), last: isoDate(year, month, daysInMonth(year, month)) }
}

/**
 * Doctor pool, unavailability and adjacency seeds are all clinic-scoped (§2.6):
 * clinics never interact — a duty in one clinic must not constrain another.
 */
async function buildContext(
  year: number,
  month: number,
  clinicId: number,
): Promise<SchedulingContext> {
  const { first, last } = monthBounds(year, month)
  const [openDuty, slots, minimums] = await Promise.all([
    getOpenDutySettings(),
    getDutySlots(clinicId),
    getDutyMinimums(clinicId),
  ])

  const dr = await query<{
    id: number
    max_monthly_duties: number
    first_name: string
    last_name: string
  }>(
    `SELECT d.id, d.max_monthly_duties, u.first_name, u.last_name
     FROM doctors d JOIN users u ON u.id = d.user_id
     WHERE u.is_active = TRUE AND d.clinic_id = $1 ORDER BY d.id`,
    [clinicId],
  )
  const doctors: DoctorSpec[] = dr.rows.map((r) => ({
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    maxMonthlyDuties: r.max_monthly_duties,
    isActive: true,
  }))

  const ures = await query<{ doctor_id: number; start_date: string; end_date: string }>(
    `SELECT x.doctor_id, x.start_date, x.end_date FROM unavailability x
     JOIN doctors d ON d.id = x.doctor_id
     WHERE d.clinic_id = $1 AND x.start_date <= $2 AND x.end_date >= $3 AND x.is_disabled = FALSE`,
    [clinicId, last, first],
  )
  const unavailability = new Map<number, Array<{ start: string; end: string }>>()
  for (const r of ures.rows) {
    const list = unavailability.get(r.doctor_id) ?? []
    list.push({ start: r.start_date, end: r.end_date })
    unavailability.set(r.doctor_id, list)
  }

   const days = []
  const hres = await query<{ holiday_date: string }>(
    `SELECT holiday_date::text AS holiday_date FROM holidays
     WHERE clinic_id = $1 AND holiday_date >= $2 AND holiday_date <= $3`,
    [clinicId, first, last],
  )
  const holidayDates = new Set(hres.rows.map((r) => r.holiday_date))
   const total = daysInMonth(year, month)
   for (let d = 1; d <= total; d++) {
     const date = isoDate(year, month, d)
    days.push({
      date,
      dayOfWeek: dayOfWeekISO(date),
      isWeekend: isWeekendISO(date),
      isHoliday: isWeekendISO(date) || holidayDates.has(date),
    })
   }

  // Adjacency seeds read duties through the schedule's clinic (§2.6.1).
  const firstDayPrev = prevDate(first)
  const pres = await query<{ doctor_id: number }>(
    `SELECT du.doctor_id FROM duties du JOIN schedules s ON s.id = du.schedule_id
     WHERE du.duty_date = $1 AND s.clinic_id = $2`,
    [firstDayPrev, clinicId],
  )
  const priorDayDoctorIds = new Set(pres.rows.map((r) => r.doctor_id))

  return { year, month, days, doctors, unavailability, priorDayDoctorIds, openDuty, slots, minimums }
}

export interface EligibilityInput {
  doctors: DoctorSpec[]
  unavailability: Map<number, Array<{ start: string; end: string }>>
  days: { date: string; dayOfWeek: number; isWeekend: boolean; isHoliday: boolean }[]
  /** Classifies each day as an open or closed on-call day while building DayInfo. */
  openDuty: OpenDutySettings
  /** Per-day on-call capacity: open slots on open days, closed slots otherwise. */
  slots: DutySlotsSettings
  /** Per-day hard minimum: open minimum on open days, closed minimum otherwise. */
  minimums: DutyMinimumSettings
  dutiesByDate: Map<string, Set<number>>
  dutyCountByDoctor: Map<number, number>
  holidayByDoctor: Map<number, number>
  /** Duties each doctor already holds on open on-call days (strict cap of 1). */
  openByDoctor: Map<number, number>
}

export function computeEligibility(input: EligibilityInput): DayInfo[] {
  const out: DayInfo[] = []
  for (const day of input.days) {
    const eligible: number[] = []
    const available: number[] = []
    const isOpen = isOpenDutyDate(day.date, input.openDuty.anchorDate, input.openDuty.intervalDays)
    const todays = input.dutiesByDate.get(day.date) ?? new Set<number>()
    const yesterdays = input.dutiesByDate.get(prevDate(day.date))
    const tomorrows = input.dutiesByDate.get(nextDate(day.date))
    for (const doc of input.doctors) {
      const ranges = input.unavailability.get(doc.id)
      const isAvail = isAvailable(doc.id, day.date, ranges).ok
      if (isAvail) available.push(doc.id)
      if (!isAvail) continue
      // Evaluate as if the doctor's own duty on this day were removed, so the
      // list answers "could this doctor hold this slot" for swaps.
      const assignedToday = todays.has(doc.id)
      const count = (input.dutyCountByDoctor.get(doc.id) ?? 0) - (assignedToday ? 1 : 0)
      if (!underCap(count, doc.maxMonthlyDuties).ok) continue
      // Strict rule: one open on-call duty per doctor, even on open days.
      if (
        isOpen &&
        !underOpenDutyCap((input.openByDoctor.get(doc.id) ?? 0) - (assignedToday ? 1 : 0)).ok
      )
        continue
      if (
        day.isHoliday &&
        !underHolidayCap((input.holidayByDoctor.get(doc.id) ?? 0) - (assignedToday ? 1 : 0)).ok
      )
        continue
      const onDutyAdjacent =
        (yesterdays?.has(doc.id) ?? false) || (tomorrows?.has(doc.id) ?? false)
      if (!notConsecutive(onDutyAdjacent).ok) continue
      eligible.push(doc.id)
    }
    out.push({
      date: day.date,
      isWeekend: day.isWeekend,
      dutyType: isOpen ? 'open' : 'closed',
      slotsRequired: slotsForDate(day.date, input.openDuty, input.slots),
      slotsMinimum: minimumForDate(day.date, input.openDuty, input.minimums),
      eligibleDoctorIds: eligible,
      availableDoctorIds: available,
    })
  }
  return out
}

/**
 * Seed the adjacency map with duties from the days just outside the month so
 * day-1 / last-day eligibility respects back-to-back across month boundaries.
 * Reads go through the clinic-scoped duty join (§2.6.1).
 */
async function seedAdjacentDuties(
  dutiesByDate: Map<string, Set<number>>,
  ctx: SchedulingContext,
  clinicId: number,
): Promise<void> {
  const first = ctx.days[0]?.date
  const last = ctx.days.at(-1)?.date
  if (!first || !last) return
  dutiesByDate.set(prevDate(first), new Set(ctx.priorDayDoctorIds))
  const res = await query<{ doctor_id: number }>(
    `SELECT du.doctor_id FROM duties du JOIN schedules s ON s.id = du.schedule_id
     WHERE du.duty_date = $1 AND s.clinic_id = $2`,
    [nextDate(last), clinicId],
  )
  dutiesByDate.set(nextDate(last), new Set(res.rows.map((r) => r.doctor_id)))
}

function holidayDatesOf(days: { date: string; isHoliday: boolean }[]): Set<string> {
  return new Set(days.filter((d) => d.isHoliday).map((d) => d.date))
}

function openDatesOf(days: { date: string }[], openDuty: OpenDutySettings): Set<string> {
  return new Set(
    days
      .filter((d) => isOpenDutyDate(d.date, openDuty.anchorDate, openDuty.intervalDays))
      .map((d) => d.date),
  )
}

function buildDutyMaps(
  assignments: { date: string; doctorId: number }[],
  holidayDates: Set<string>,
  openDates: Set<string>,
) {
  const dutiesByDate = new Map<string, Set<number>>()
  const dutyCountByDoctor = new Map<number, number>()
  const holidayByDoctor = new Map<number, number>()
  const openByDoctor = new Map<number, number>()
  for (const a of assignments) {
    const set = dutiesByDate.get(a.date) ?? new Set<number>()
    set.add(a.doctorId)
    dutiesByDate.set(a.date, set)
    dutyCountByDoctor.set(a.doctorId, (dutyCountByDoctor.get(a.doctorId) ?? 0) + 1)
    if (holidayDates.has(a.date))
      holidayByDoctor.set(a.doctorId, (holidayByDoctor.get(a.doctorId) ?? 0) + 1)
    if (openDates.has(a.date))
      openByDoctor.set(a.doctorId, (openByDoctor.get(a.doctorId) ?? 0) + 1)
  }
  return { dutiesByDate, dutyCountByDoctor, holidayByDoctor, openByDoctor }
}

export async function preview(
  year: number,
  month: number,
  scope: ClinicScope,
  plan?: GenerateAssignment[],
): Promise<PreviewResult> {
  const ctx = await buildContext(year, month, scope.clinicId)
  const openDuty = ctx.openDuty
  if (plan) {
    // WYSIWYG refresh: the admin edited the proposal in the browser, so
    // eligibility must answer against their plan, not the engine's. Nothing
    // is persisted; assignments/conflicts are echoed/blanked for shape only.
    const maps = buildDutyMaps(plan, holidayDatesOf(ctx.days), openDatesOf(ctx.days, openDuty))
    await seedAdjacentDuties(maps.dutiesByDate, ctx, scope.clinicId)
    const days = computeEligibility({
      doctors: ctx.doctors,
      unavailability: ctx.unavailability,
      days: ctx.days,
      openDuty,
      slots: ctx.slots,
      minimums: ctx.minimums,
      ...maps,
    })
    const names = new Map(ctx.doctors.map((d) => [d.id, d]))
    return {
      assignments: plan.map((a) => {
        const doc = names.get(a.doctorId)
        return {
          date: a.date,
          doctorId: a.doctorId,
          doctorFirstName: doc?.firstName ?? '',
          doctorLastName: doc?.lastName ?? '',
          isWeekend: isWeekendISO(a.date),
          reason: a.reason ?? 'plan',
        }
      }),
      conflicts: [],
      days,
    }
  }
  const result = runEngine(ctx)
  const maps = buildDutyMaps(result.assignments, holidayDatesOf(ctx.days), openDatesOf(ctx.days, openDuty))
  await seedAdjacentDuties(maps.dutiesByDate, ctx, scope.clinicId)
  const days = computeEligibility({
    doctors: ctx.doctors,
    unavailability: ctx.unavailability,
    days: ctx.days,
    openDuty,
    slots: ctx.slots,
    minimums: ctx.minimums,
    ...maps,
  })
  return { assignments: result.assignments, conflicts: result.conflicts, days }
}

interface PlanDuty {
  date: string
  doctorId: number
  isWeekend: boolean
  reason: string
}

export async function generate(
  year: number,
  month: number,
  actor: Actor,
  scope: ClinicScope,
  assignments?: GenerateAssignment[],
): Promise<ScheduleDetail> {
  // Uniqueness is per clinic (D6): another clinic's schedule for the same
  // month must not block this one.
  const exists = await query(
    'SELECT id FROM schedules WHERE year = $1 AND month = $2 AND clinic_id = $3',
    [year, month, scope.clinicId],
  )
  if (exists.rows.length > 0)
    throw new HttpError(409, 'Schedule already exists for this month; delete it first')

  const ctx = await buildContext(year, month, scope.clinicId)

  const planDuties =
    assignments && assignments.length > 0
      ? validatePlan(ctx, assignments)
      : enginePlanToDuties(runEngine(ctx))

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
        mode: assignments && assignments.length > 0 ? 'manual' : 'engine',
      },
    })
    return id
  })
  return getById(scheduleId, actor)
}

function enginePlanToDuties(result: GenerateResult): PlanDuty[] {
  if (result.conflicts.length > 0)
    throw new HttpError(
      422,
      `Schedule has ${result.conflicts.length} unfillable day(s); Preview the schedule and resolve conflicts before generating a plan`,
    )
  return result.assignments.map((a) => ({
    date: a.date,
    doctorId: a.doctorId,
    isWeekend: a.isWeekend,
    reason: a.reason,
  }))
}

function validatePlan(ctx: SchedulingContext, assignments: GenerateAssignment[]): PlanDuty[] {
  const activeIds = new Set(ctx.doctors.map((d) => d.id))
  const dayInfo = new Map(ctx.days.map((d) => [d.date, d]))
  const monthDates = new Set(ctx.days.map((d) => d.date))

  const byDate = new Map<string, GenerateAssignment[]>()
  for (const a of assignments) {
    if (!monthDates.has(a.date))
      throw new HttpError(400, `Assignment date ${a.date} is outside the schedule month`)
    if (!activeIds.has(a.doctorId))
      throw new HttpError(400, `Doctor ${a.doctorId} is not an active doctor`)
    const ranges = ctx.unavailability.get(a.doctorId)
    if (!isAvailable(a.doctorId, a.date, ranges).ok)
      throw new HttpError(
        409,
        `Constraint violation: doctor ${a.doctorId} unavailable on ${a.date}`,
      )
    const arr = byDate.get(a.date) ?? []
    if (arr.some((x) => x.doctorId === a.doctorId))
      throw new HttpError(
        409,
        `Constraint violation: doctor ${a.doctorId} already assigned to ${a.date}`,
      )
    arr.push(a)
    byDate.set(a.date, arr)
  }

  for (const [date, arr] of byDate) {
    const max = slotsForDate(date, ctx.openDuty, ctx.slots)
    if (arr.length > max)
      throw new HttpError(
        409,
        `Too many assignments (${arr.length}) for ${date}; max ${max}`,
      )
  }

  const empty: string[] = []
  for (const date of monthDates) {
    if (!byDate.has(date)) empty.push(date)
  }
  if (empty.length > 0)
    throw new HttpError(
      422,
      `${empty.length} day(s) have no doctor: ${empty.join(', ')}; assign at least one per day`,
    )

  // Strict rule: every day holds at least its minimum (open minimum on open
  // on-call days, closed minimum on all others, including the day after an
  // open day).
  const short = ctx.days
    .map((d) => d.date)
    .filter(
      (date) =>
        (byDate.get(date)?.length ?? 0) < minimumForDate(date, ctx.openDuty, ctx.minimums),
    )
  if (short.length > 0)
    throw new HttpError(
      422,
      `${short.length} day(s) are below their minimum on-call doctors: ${short.join(', ')}; every day needs at least its minimum`,
    )

  // Open on-call days and the day right after them are critical: fairness
  // caps never block them, mirroring the engine.
  const criticalDates = new Set(
    ctx.days.filter((d) => requiresDoubleCoverage(d.date, ctx.openDuty)).map((d) => d.date),
  )

  // Same hard constraints the engine and validateAssignment enforce, so a
  // manual plan cannot persist an impossible schedule.
  const doctorsById = new Map(ctx.doctors.map((d) => [d.id, d]))
  const firstDate = ctx.days[0]?.date ?? ''
  const beforeFirst = firstDate ? prevDate(firstDate) : ''
  const counts = new Map<number, { total: number; holiday: number; open: number }>()
  for (const a of assignments) {
    const info = dayInfo.get(a.date)!
    const c = counts.get(a.doctorId) ?? { total: 0, holiday: 0, open: 0 }
    c.total++
    if (info.isHoliday) c.holiday++
    const isOpenDay = isOpenDutyDate(a.date, ctx.openDuty.anchorDate, ctx.openDuty.intervalDays)
    if (isOpenDay) c.open++
    counts.set(a.doctorId, c)
    const spec = doctorsById.get(a.doctorId)!
    if (c.total > spec.maxMonthlyDuties)
      throw new HttpError(
        409,
        `Constraint violation: doctor ${a.doctorId} exceeds the monthly cap of ${spec.maxMonthlyDuties} duties`,
      )
    // Strict rule: one open on-call duty per doctor — never a second, even
    // on a critical day.
    if (isOpenDay && c.open > OPEN_DUTY_DUTY_CAP)
      throw new HttpError(
        409,
        `Constraint violation: doctor ${a.doctorId} exceeds the limit of ${OPEN_DUTY_DUTY_CAP} duty on open on-call days`,
      )
    // Fairness caps never block a duty on a critical day, mirroring the
    // engine, and they yield to the minimum-coverage guarantee: an over-cap
    // duty is accepted exactly when its day holds no more than its minimum,
    // because removing it would leave that day short. Engine-relaxed days
    // never exceed their minimum, so this admits precisely the overflows the
    // engine can produce — nothing looser.
    const withinMinimum =
      (byDate.get(a.date)?.length ?? 0) <= minimumForDate(a.date, ctx.openDuty, ctx.minimums)
    if (
      !criticalDates.has(a.date) &&
      !withinMinimum &&
      info.isHoliday &&
      c.holiday > HOLIDAY_DUTY_CAP
    )
      throw new HttpError(
        409,
        `Constraint violation: doctor ${a.doctorId} exceeds the holiday cap of ${HOLIDAY_DUTY_CAP} duties on holiday days`,
      )
    const prev = prevDate(a.date)
    const onDutyYesterday =
      byDate.get(prev)?.some((x) => x.doctorId === a.doctorId) ??
      (prev === beforeFirst && ctx.priorDayDoctorIds.has(a.doctorId))
    if (onDutyYesterday)
      throw new HttpError(
        409,
        `Constraint violation: doctor ${a.doctorId} would be on duty back-to-back on ${a.date}`,
      )
  }

  return assignments.map((a) => {
    const info = dayInfo.get(a.date)!
    return {
      date: a.date,
      doctorId: a.doctorId,
      isWeekend: info.isWeekend,
      reason: a.reason ?? 'plan',
    }
  })
}

export async function list(
  filters: ScheduleQuery = {},
  actor?: Actor,
  scope?: ClinicScope,
): Promise<ScheduleSummary[]> {
  const where: string[] = []
  const params: unknown[] = []
  if (scope !== undefined) {
    params.push(scope.clinicId)
    where.push(`s.clinic_id = $${params.length}`)
  }
  if (actor && actor.role === 'doctor') {
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
  const sql =
    where.length > 0
      ? `${SELECT_SCHEDULE} WHERE ${where.join(' AND ')} ORDER BY s.year DESC, s.month DESC`
      : `${SELECT_SCHEDULE} ORDER BY s.year DESC, s.month DESC`
  const res = await query<ScheduleRow>(sql, params)
  return res.rows.map(toSchedule)
}

export async function getScheduleDuties(
  id: number,
  actor?: Actor,
): Promise<{ schedule: ScheduleSummary; duties: Duty[] }> {
  const schedule = await selectScheduleRow(id)
  assertScheduleVisible(schedule, actor)
  const dres = await query<DutyRow>(
    `${SELECT_DUTY} WHERE du.schedule_id = $1 ORDER BY du.duty_date, du.id`,
    [id],
  )
  return { schedule: toSchedule(schedule), duties: dres.rows.map(toDuty) }
}

export async function getById(id: number, actor?: Actor): Promise<ScheduleDetail> {
  const { schedule, duties } = await getScheduleDuties(id, actor)
  const isAdmin = actor?.role === 'administrator' || actor?.role === 'superadmin'
  if (actor && !isAdmin && schedule.status !== 'published') {
    throw new HttpError(403, 'Schedule not published')
  }
  if (!isAdmin) {
    // Calendar shape only — skip the eligibility work that gets blanked anyway.
    const [openDuty, slots, minimums] = await Promise.all([
      getOpenDutySettings(),
      getDutySlots(schedule.clinicId),
      getDutyMinimums(schedule.clinicId),
    ])
    const total = daysInMonth(schedule.year, schedule.month)
    const days: DayInfo[] = []
    for (let d = 1; d <= total; d++) {
      const date = isoDate(schedule.year, schedule.month, d)
      days.push({
        date,
        isWeekend: isWeekendISO(date),
        dutyType: isOpenDutyDate(date, openDuty.anchorDate, openDuty.intervalDays)
          ? 'open'
          : 'closed',
        slotsRequired: slotsForDate(date, openDuty, slots),
        slotsMinimum: minimumForDate(date, openDuty, minimums),
        eligibleDoctorIds: [],
        availableDoctorIds: [],
      })
    }
    return { schedule, duties, days }
  }
  const ctx = await buildContext(schedule.year, schedule.month, schedule.clinicId)
  const dutiesByDate = new Map<string, Set<number>>()
  const dutyCountByDoctor = new Map<number, number>()
  const holidayByDoctor = new Map<number, number>()
  const openByDoctor = new Map<number, number>()
  const holidayDates = holidayDatesOf(ctx.days)
  const openDates = openDatesOf(ctx.days, ctx.openDuty)
  for (const d of duties) {
    const set = dutiesByDate.get(d.dutyDate) ?? new Set<number>()
    set.add(d.doctorId)
    dutiesByDate.set(d.dutyDate, set)
    dutyCountByDoctor.set(d.doctorId, (dutyCountByDoctor.get(d.doctorId) ?? 0) + 1)
    if (holidayDates.has(d.dutyDate))
      holidayByDoctor.set(d.doctorId, (holidayByDoctor.get(d.doctorId) ?? 0) + 1)
    if (openDates.has(d.dutyDate))
      openByDoctor.set(d.doctorId, (openByDoctor.get(d.doctorId) ?? 0) + 1)
  }
  await seedAdjacentDuties(dutiesByDate, ctx, schedule.clinicId)
  const days = computeEligibility({
    doctors: ctx.doctors,
    unavailability: ctx.unavailability,
    days: ctx.days,
    openDuty: ctx.openDuty,
    slots: ctx.slots,
    minimums: ctx.minimums,
    dutiesByDate,
    dutyCountByDoctor,
    holidayByDoctor,
    openByDoctor,
  })
  return { schedule, duties, days }
}

export async function remove(id: number, actor: Actor): Promise<void> {
  const existing = await selectScheduleRow(id)
  assertScheduleVisible(existing, actor)
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
  const schedule = await selectScheduleRow(duty.schedule_id)
  assertScheduleVisible(schedule, actor)
  return duty
}

async function validateAssignment(
  scheduleId: number,
  clinicId: number,
  doctorId: number,
  date: string,
  excludeDutyId: number | null,
  year: number,
  month: number,
): Promise<void> {
  // The doctor must belong to the schedule's clinic: unknown and cross-clinic
  // doctors are the same 404 (isolation I9).
  const dr = await query<{ max_monthly_duties: number; is_active: boolean }>(
    `SELECT d.max_monthly_duties, u.is_active FROM doctors d JOIN users u ON u.id = d.user_id
     WHERE d.id = $1 AND d.clinic_id = $2`,
    [doctorId, clinicId],
  )
  const doctor = dr.rows[0]
  if (!doctor) throw new HttpError(404, 'Doctor not found')
  if (!doctor.is_active) throw new HttpError(409, 'Constraint violation: doctor inactive')

  const rangesRes = await query<{ start_date: string; end_date: string }>(
    `SELECT start_date, end_date FROM unavailability WHERE doctor_id = $1 AND start_date <= $2 AND end_date >= $2 AND is_disabled = FALSE`,
    [doctorId, date],
  )
  if (
    !isAvailable(
      doctorId,
      date,
      rangesRes.rows.map((r) => ({ start: r.start_date, end: r.end_date })),
    ).ok
  )
    throw new HttpError(409, 'Constraint violation: doctor unavailable on this date')

  const capRes = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM duties WHERE schedule_id = $1 AND doctor_id = $2 AND ($3::int IS NULL OR id <> $3)`,
    [scheduleId, doctorId, excludeDutyId],
  )
  const count = capRes.rows[0]?.n ?? 0
  if (!underCap(count, doctor.max_monthly_duties).ok)
    throw new HttpError(409, 'Constraint violation: monthly cap reached')

  const dupRes = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM duties
     WHERE schedule_id = $1 AND duty_date = $2 AND doctor_id = $3
     AND ($4::int IS NULL OR id <> $4)`,
    [scheduleId, date, doctorId, excludeDutyId],
  )
  if ((dupRes.rows[0]?.n ?? 0) > 0)
    throw new HttpError(409, 'Constraint violation: doctor already assigned to this date')

  // Strict rule: one open on-call duty per doctor per schedule. A second is
  // refused even when the open day still needs its second doctor — the duty
  // must go to a different doctor. The day after an open day is protected by
  // double coverage but is not itself open, so it does not count here.
  const openDuty = await getOpenDutySettings()
  if (isOpenDutyDate(date, openDuty.anchorDate, openDuty.intervalDays)) {
    const otherRes = await query<{ duty_date: string }>(
      `SELECT duty_date::text AS duty_date FROM duties
       WHERE schedule_id = $1 AND doctor_id = $2 AND ($3::int IS NULL OR id <> $3)`,
      [scheduleId, doctorId, excludeDutyId],
    )
    const alreadyHasOpen = otherRes.rows.some((r) =>
      isOpenDutyDate(r.duty_date, openDuty.anchorDate, openDuty.intervalDays),
    )
    if (alreadyHasOpen)
      throw new HttpError(
        409,
        `Constraint violation: doctor ${doctorId} already holds a duty on an open on-call day; limit is ${OPEN_DUTY_DUTY_CAP} per doctor`,
      )
  }

  // The holiday cap never blocks a duty on an open on-call day or the day
  // after it — same relaxation as the engine. Hard constraints above
  // (availability, monthly cap, duplicates, open-day limit) still apply.
  if (!requiresDoubleCoverage(date, openDuty)) {
    // Holiday cap: weekends always count; marked clinic holidays add more.
    let marked: string[] = []
    if (!isWeekendISO(date)) {
      const { first, last } = monthBounds(year, month)
      const mh = await query<{ holiday_date: string }>(
        `SELECT holiday_date::text AS holiday_date FROM holidays
         WHERE clinic_id = $1 AND holiday_date >= $2 AND holiday_date <= $3`,
        [clinicId, first, last],
      )
      marked = mh.rows.map((r) => r.holiday_date)
    }
    if (isWeekendISO(date) || marked.includes(date)) {
      const holRes = await query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM duties
         WHERE schedule_id = $1 AND doctor_id = $2 AND ($3::int IS NULL OR id <> $3)
         AND (is_weekend OR duty_date::text = ANY($4::text[]))`,
        [scheduleId, doctorId, excludeDutyId, marked],
      )
      if (!underHolidayCap(holRes.rows[0]?.n ?? 0).ok)
        throw new HttpError(
          409,
          `Constraint violation: doctor ${doctorId} exceeds the holiday cap of ${HOLIDAY_DUTY_CAP} duties on holiday days`,
        )
    }
  }

  // Neighbor check goes through the schedule's clinic (§2.6.1): another
  // clinic's duty never blocks this doctor (isolation I11).
  const prev = prevDate(date)
  const next = nextDate(date)
  const nb = await query<{ doctor_id: number }>(
    `SELECT du.doctor_id FROM duties du JOIN schedules s ON s.id = du.schedule_id
     WHERE du.duty_date IN ($1, $2) AND s.clinic_id = $3`,
    [prev, next, clinicId],
  )
  const onDutyAdjacent = nb.rows.some((r) => r.doctor_id === doctorId)
  if (!notConsecutive(onDutyAdjacent).ok)
    throw new HttpError(409, 'Constraint violation: back-to-back')
}

function assertEditable(
  status: string,
  message = 'Schedule is published; revert to draft to edit',
): void {
  if (status === 'published') throw new HttpError(409, message)
}

/** Locks the schedule row and enforces draft-only edits inside the caller's transaction. */
async function lockScheduleForEdit(client: PoolClient, scheduleId: number): Promise<void> {
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
  assertScheduleVisible(schedule, actor)
  if (!inMonth(input.date, schedule.year, schedule.month))
    throw new HttpError(400, 'Date is outside this schedule month')

  assertEditable(schedule.status)

  const existing = await query<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM duties WHERE schedule_id = $1 AND duty_date = $2',
    [scheduleId, input.date],
  )
  const [openDuty, dutySlots] = await Promise.all([
    getOpenDutySettings(),
    getDutySlots(schedule.clinic_id),
  ])
  const slots = slotsForDate(input.date, openDuty, dutySlots)
  if ((existing.rows[0]?.n ?? 0) >= slots)
    throw new HttpError(409, `All ${slots} on-call slots for this date are already filled`)

  await validateAssignment(
    scheduleId,
    schedule.clinic_id,
    input.doctorId,
    input.date,
    null,
    schedule.year,
    schedule.month,
  )

  const reason = `manual override by admin #${actor.id}`
  const id = await withTransaction(async (client) => {
    await lockScheduleForEdit(client, scheduleId)
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
  await validateAssignment(
    duty.schedule_id,
    duty.schedule_clinic_id,
    input.doctorId,
    duty.duty_date,
    dutyId,
    duty.schedule_year,
    duty.schedule_month,
  )
  const reason = `manual override by admin #${actor.id}`
  await withTransaction(async (client) => {
    await lockScheduleForEdit(client, duty.schedule_id)
    await client.query('UPDATE duties SET doctor_id = $1, reason = $2 WHERE id = $3', [
      input.doctorId,
      reason,
      dutyId,
    ])
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
  // their minimum through a removal — such a duty must be reassigned instead.
  // The count is read under the schedule lock so concurrent removals cannot
  // both pass.
  const [openDuty, minimums] = await Promise.all([
    getOpenDutySettings(),
    getDutyMinimums(duty.schedule_clinic_id),
  ])
  const minimum = minimumForDate(duty.duty_date, openDuty, minimums)
  await withTransaction(async (client) => {
    await lockScheduleForEdit(client, duty.schedule_id)
    if (requiresDoubleCoverage(duty.duty_date, openDuty)) {
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
    await client.query('DELETE FROM duties WHERE id = $1', [dutyId])
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

export async function publish(id: number, actor: Actor): Promise<ScheduleSummary> {
  const existing = await selectScheduleRow(id)
  assertScheduleVisible(existing, actor)
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
      detail: { year: existing.year, month: existing.month, dutyCount: byDate.size },
    })
  })
  return toSchedule(await selectScheduleRow(id))
}

export async function unpublish(id: number, actor: Actor): Promise<ScheduleSummary> {
  const existing = await selectScheduleRow(id)
  assertScheduleVisible(existing, actor)
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
