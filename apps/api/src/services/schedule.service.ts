import type {
  AuthUser,
  CreateDutyRequest,
  DayInfo,
  Duty,
  GenerateAssignment,
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
  balanceCap,
  DOCTORS_PER_DAY,
  generate as runEngine,
  isAvailable,
  notConsecutive,
  underCap,
} from '../scheduling'
import {
  daysInMonth,
  dayOfWeekISO,
  inMonth,
  isWeekendISO,
  isoDate,
  nextDate,
  prevDate,
} from '../scheduling/dates'
import type { DoctorSpec, GenerateResult, SchedulingContext } from '../scheduling/types'
import { recordGeneration } from './usage.service'
import { recordActivity } from './activity.service'

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
     WHERE d.clinic_id = $1 AND x.start_date <= $2 AND x.end_date >= $3`,
    [clinicId, last, first],
  )
  const unavailability = new Map<number, Array<{ start: string; end: string }>>()
  for (const r of ures.rows) {
    const list = unavailability.get(r.doctor_id) ?? []
    list.push({ start: r.start_date, end: r.end_date })
    unavailability.set(r.doctor_id, list)
  }

  const days = []
  const total = daysInMonth(year, month)
  for (let d = 1; d <= total; d++) {
    const date = isoDate(year, month, d)
    days.push({ date, dayOfWeek: dayOfWeekISO(date), isWeekend: isWeekendISO(date) })
  }

  // Adjacency seeds read duties through the schedule's clinic (§2.6.1).
  const firstDayPrev = prevDate(first)
  const pres = await query<{ doctor_id: number }>(
    `SELECT du.doctor_id FROM duties du JOIN schedules s ON s.id = du.schedule_id
     WHERE du.duty_date = $1 AND s.clinic_id = $2`,
    [firstDayPrev, clinicId],
  )
  const priorDayDoctorIds = new Set(pres.rows.map((r) => r.doctor_id))

  return { year, month, days, doctors, unavailability, priorDayDoctorIds }
}

export interface EligibilityInput {
  doctors: DoctorSpec[]
  unavailability: Map<number, Array<{ start: string; end: string }>>
  days: { date: string; dayOfWeek: number; isWeekend: boolean }[]
  dutiesByDate: Map<string, Set<number>>
  dutyCountByDoctor: Map<number, number>
  saturdayByDoctor: Map<number, number>
  sundayByDoctor: Map<number, number>
}

export function computeEligibility(input: EligibilityInput): DayInfo[] {
  const out: DayInfo[] = []
  const activeCount = input.doctors.length
  const saturdays = input.days.filter((d) => d.dayOfWeek === 6).length
  const sundays = input.days.filter((d) => d.dayOfWeek === 0).length
  const satCap = balanceCap(DOCTORS_PER_DAY * saturdays, activeCount)
  const sunCap = balanceCap(DOCTORS_PER_DAY * sundays, activeCount)
  for (const day of input.days) {
    const eligible: number[] = []
    const available: number[] = []
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
      if (day.dayOfWeek === 6 && !underCap((input.saturdayByDoctor.get(doc.id) ?? 0) - (assignedToday ? 1 : 0), satCap).ok)
        continue
      if (day.dayOfWeek === 0 && !underCap((input.sundayByDoctor.get(doc.id) ?? 0) - (assignedToday ? 1 : 0), sunCap).ok)
        continue
      const onDutyAdjacent =
        (yesterdays?.has(doc.id) ?? false) || (tomorrows?.has(doc.id) ?? false)
      if (!notConsecutive(onDutyAdjacent).ok) continue
      eligible.push(doc.id)
    }
    out.push({
      date: day.date,
      isWeekend: day.isWeekend,
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

function buildDutyMaps(assignments: { date: string; doctorId: number }[]) {
  const dutiesByDate = new Map<string, Set<number>>()
  const dutyCountByDoctor = new Map<number, number>()
  const saturdayByDoctor = new Map<number, number>()
  const sundayByDoctor = new Map<number, number>()
  for (const a of assignments) {
    const set = dutiesByDate.get(a.date) ?? new Set<number>()
    set.add(a.doctorId)
    dutiesByDate.set(a.date, set)
    dutyCountByDoctor.set(a.doctorId, (dutyCountByDoctor.get(a.doctorId) ?? 0) + 1)
    const dow = dayOfWeekISO(a.date)
    if (dow === 6) saturdayByDoctor.set(a.doctorId, (saturdayByDoctor.get(a.doctorId) ?? 0) + 1)
    if (dow === 0) sundayByDoctor.set(a.doctorId, (sundayByDoctor.get(a.doctorId) ?? 0) + 1)
  }
  return { dutiesByDate, dutyCountByDoctor, saturdayByDoctor, sundayByDoctor }
}

export async function preview(
  year: number,
  month: number,
  scope: ClinicScope,
  plan?: GenerateAssignment[],
): Promise<PreviewResult> {
  const ctx = await buildContext(year, month, scope.clinicId)
  if (plan) {
    // WYSIWYG refresh: the admin edited the proposal in the browser, so
    // eligibility must answer against their plan, not the engine's. Nothing
    // is persisted; assignments/conflicts are echoed/blanked for shape only.
    const maps = buildDutyMaps(plan)
    await seedAdjacentDuties(maps.dutiesByDate, ctx, scope.clinicId)
    const days = computeEligibility({
      doctors: ctx.doctors,
      unavailability: ctx.unavailability,
      days: ctx.days,
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
  const maps = buildDutyMaps(result.assignments)
  await seedAdjacentDuties(maps.dutiesByDate, ctx, scope.clinicId)
  const days = computeEligibility({
    doctors: ctx.doctors,
    unavailability: ctx.unavailability,
    days: ctx.days,
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
    if (arr.length > DOCTORS_PER_DAY)
      throw new HttpError(
        409,
        `Too many assignments (${arr.length}) for ${date}; max ${DOCTORS_PER_DAY}`,
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

  // Same hard constraints the engine and validateAssignment enforce, so a
  // manual plan cannot persist an impossible schedule.
  const doctorsById = new Map(ctx.doctors.map((d) => [d.id, d]))
  const activeCount = ctx.doctors.length
  const satCap = balanceCap(DOCTORS_PER_DAY * ctx.days.filter((d) => d.dayOfWeek === 6).length, activeCount)
  const sunCap = balanceCap(DOCTORS_PER_DAY * ctx.days.filter((d) => d.dayOfWeek === 0).length, activeCount)
  const firstDate = ctx.days[0]?.date ?? ''
  const beforeFirst = firstDate ? prevDate(firstDate) : ''
  const counts = new Map<number, { total: number; saturday: number; sunday: number }>()
  for (const a of assignments) {
    const info = dayInfo.get(a.date)!
    const c = counts.get(a.doctorId) ?? { total: 0, saturday: 0, sunday: 0 }
    c.total++
    if (info.dayOfWeek === 6) c.saturday++
    if (info.dayOfWeek === 0) c.sunday++
    counts.set(a.doctorId, c)
    const spec = doctorsById.get(a.doctorId)!
    if (c.total > spec.maxMonthlyDuties)
      throw new HttpError(
        409,
        `Constraint violation: doctor ${a.doctorId} exceeds the monthly cap of ${spec.maxMonthlyDuties} duties`,
      )
    if (info.dayOfWeek === 6 && c.saturday > satCap)
      throw new HttpError(409, `Constraint violation: doctor ${a.doctorId} exceeds the Saturday balance cap`)
    if (info.dayOfWeek === 0 && c.sunday > sunCap)
      throw new HttpError(409, `Constraint violation: doctor ${a.doctorId} exceeds the Sunday balance cap`)
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
    const total = daysInMonth(schedule.year, schedule.month)
    const days: DayInfo[] = []
    for (let d = 1; d <= total; d++) {
      const date = isoDate(schedule.year, schedule.month, d)
      days.push({
        date,
        isWeekend: isWeekendISO(date),
        eligibleDoctorIds: [],
        availableDoctorIds: [],
      })
    }
    return { schedule, duties, days }
  }
  const ctx = await buildContext(schedule.year, schedule.month, schedule.clinicId)
  const dutiesByDate = new Map<string, Set<number>>()
  const dutyCountByDoctor = new Map<number, number>()
  const saturdayByDoctor = new Map<number, number>()
  const sundayByDoctor = new Map<number, number>()
  for (const d of duties) {
    const set = dutiesByDate.get(d.dutyDate) ?? new Set<number>()
    set.add(d.doctorId)
    dutiesByDate.set(d.dutyDate, set)
    dutyCountByDoctor.set(d.doctorId, (dutyCountByDoctor.get(d.doctorId) ?? 0) + 1)
    const dow = dayOfWeekISO(d.dutyDate)
    if (dow === 6) saturdayByDoctor.set(d.doctorId, (saturdayByDoctor.get(d.doctorId) ?? 0) + 1)
    if (dow === 0) sundayByDoctor.set(d.doctorId, (sundayByDoctor.get(d.doctorId) ?? 0) + 1)
  }
  await seedAdjacentDuties(dutiesByDate, ctx, schedule.clinicId)
  const days = computeEligibility({
    doctors: ctx.doctors,
    unavailability: ctx.unavailability,
    days: ctx.days,
    dutiesByDate,
    dutyCountByDoctor,
    saturdayByDoctor,
    sundayByDoctor,
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

/** ±1 balance caps for one schedule month, computed like the engine does. */
async function monthCaps(year: number, month: number, clinicId: number) {
  const total = daysInMonth(year, month)
  let saturdays = 0
  let sundays = 0
  for (let d = 1; d <= total; d++) {
    const dow = dayOfWeekISO(isoDate(year, month, d))
    if (dow === 6) saturdays++
    else if (dow === 0) sundays++
  }
  const active = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM doctors d JOIN users u ON u.id = d.user_id
     WHERE u.is_active = TRUE AND d.clinic_id = $1`,
    [clinicId],
  )
  const activeCount = active.rows[0]?.n ?? 0
  return {
    saturday: balanceCap(DOCTORS_PER_DAY * saturdays, activeCount),
    sunday: balanceCap(DOCTORS_PER_DAY * sundays, activeCount),
  }
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
    `SELECT start_date, end_date FROM unavailability WHERE doctor_id = $1 AND start_date <= $2 AND end_date >= $2`,
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

  const caps = await monthCaps(year, month, clinicId)
  const dow = dayOfWeekISO(date)
  if (dow === 6 || dow === 0) {
    const wkRes = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM duties
       WHERE schedule_id = $1 AND doctor_id = $2 AND is_weekend AND ($3::int IS NULL OR id <> $3)
       AND EXTRACT(ISODOW FROM duty_date) = $4`,
      [scheduleId, doctorId, excludeDutyId, dow === 6 ? 6 : 7],
    )
    const cap = dow === 6 ? caps.saturday : caps.sunday
    if (!underCap(wkRes.rows[0]?.n ?? 0, cap).ok)
      throw new HttpError(409, `Constraint violation: ${dow === 6 ? 'saturday' : 'sunday'} balance cap reached`)
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
  if ((existing.rows[0]?.n ?? 0) >= DOCTORS_PER_DAY)
    throw new HttpError(409, 'Both on-call slots for this date are already filled')

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
  await withTransaction(async (client) => {
    await lockScheduleForEdit(client, duty.schedule_id)
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
  await withTransaction(async (client) => {
    const upd = await client.query(
      `UPDATE schedules SET status = 'published', updated_at = NOW()
       WHERE id = $1 AND status = 'draft' RETURNING id`,
      [id],
    )
    if (upd.rows.length === 0) throw new HttpError(409, 'Schedule is already published')
    const duties = await client.query<{ n: number }>(
      'SELECT COUNT(DISTINCT duty_date)::int AS n FROM duties WHERE schedule_id = $1',
      [id],
    )
    if ((duties.rows[0]?.n ?? 0) < daysInMonth(existing.year, existing.month))
      throw new HttpError(409, 'Schedule is incomplete; every day needs at least one duty before publishing')
    await recordActivity(client, {
      userId: actor.id,
      action: 'schedule.published',
      entityType: 'schedule',
      entityId: id,
      clinicId: existing.clinic_id,
      detail: { year: existing.year, month: existing.month, dutyCount: duties.rows[0]?.n ?? 0 },
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
