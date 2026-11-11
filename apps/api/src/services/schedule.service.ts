import type {
  AuthUser,
  CreateDutyRequest,
  DayInfo,
  Duty,
  DutyMinimumSettings,
  DutySlotsSettings,
  GenerateAssignment,
  OpenDutySettings,
  ReassignDutyRequest,
  ScheduleDetail,
  ScheduleAlternativeResult,
  ScheduleOption,
  ScheduleOptionsResult,
  ScheduleQuery,
  ScheduleSummary,
  ScheduleStatus,
} from '@oncall/shared'
import type { PoolClient } from 'pg'
import { query, withTransaction } from '../db/client.ts'
import { HttpError } from '../lib/http-error.ts'
import type { ClinicScope } from '../lib/scope.ts'
import {
  assignmentViolation,
  generateAlternative as runAlternative,
  generatePrimary,
  holidayCapAllows,
  isAvailable,
  planHolidayViolation,
  SOLVER_BUDGET_MS,
  SolverBusyError,
  type PrimaryState,
  underCap,
  underOpenDutyCap,
} from '../scheduling/index.ts'
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
} from '../scheduling/dates.ts'
import type { DoctorSpec, GenerateResult, SchedulingContext } from '../scheduling/types.ts'
import { recordGeneration } from './usage.service.ts'
import { recordActivity } from './activity.service.ts'
import { getDutyMinimums, getDutySlots, getOpenDutySettings } from './settings.service.ts'

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
function assertScheduleVisible(row: ScheduleRow, actor: Actor): void {
  if ((actor.role === 'administrator' || actor.role === 'doctor') && row.clinic_id !== actor.clinicId) {
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

  // Adjacent months' duties are read through the schedule's clinic (§2.6.1).
  const dayBefore = prevDate(first)
  const dayAfter = nextDate(last)
  const adjacent = await query<{ duty_date: string; doctor_id: number }>(
    `SELECT du.duty_date::text AS duty_date, du.doctor_id FROM duties du
     JOIN schedules s ON s.id = du.schedule_id
     WHERE du.duty_date IN ($1, $2) AND s.clinic_id = $3`,
    [dayBefore, dayAfter, clinicId],
  )
  const doctorsOn = (date: string): Set<number> =>
    new Set(adjacent.rows.filter((r) => r.duty_date === date).map((r) => r.doctor_id))

  return {
    clinicId,
    year,
    month,
    days,
    doctors,
    unavailability,
    priorDayDoctorIds: doctorsOn(dayBefore),
    nextDayDoctorIds: doctorsOn(dayAfter),
    openDuty,
    slots,
    minimums,
  }
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
  /** Duties by date, including the days just outside the month. */
  dutiesByDate: Map<string, Set<number>>
  dutyCountByDoctor: Map<number, number>
  /** Duties each doctor holds on non-critical holiday days. */
  regularHolidayByDoctor: Map<number, number>
  /** Duties each doctor holds on critical holiday days (exempt from the cap). */
  criticalHolidayByDoctor: Map<number, number>
  /** Duties each doctor already holds on open on-call days (strict cap of 1). */
  openByDoctor: Map<number, number>
}

export function computeEligibility(input: EligibilityInput): DayInfo[] {
  const out: DayInfo[] = []
  for (const day of input.days) {
    const eligible: number[] = []
    const available: number[] = []
    const isOpen = isOpenDutyDate(day.date, input.openDuty.anchorDate, input.openDuty.intervalDays)
    const critical = requiresDoubleCoverage(day.date, input.openDuty)
    const todays = input.dutiesByDate.get(day.date) ?? new Set<number>()
    const yesterdays = input.dutiesByDate.get(prevDate(day.date))
    const tomorrows = input.dutiesByDate.get(nextDate(day.date))
    for (const doc of input.doctors) {
      const isAvail = isAvailable(day.date, input.unavailability.get(doc.id))
      if (isAvail) available.push(doc.id)
      if (!isAvail) continue
      // Evaluate as if the doctor's own duty on this day were removed, so the
      // list answers "could this doctor hold this slot" for swaps.
      const own = todays.has(doc.id) ? 1 : 0
      if (!underCap((input.dutyCountByDoctor.get(doc.id) ?? 0) - own, doc.maxMonthlyDuties)) continue
      // Strict rule: one open on-call duty per doctor, even on open days.
      if (isOpen && !underOpenDutyCap((input.openByDoctor.get(doc.id) ?? 0) - own)) continue
      // The holiday cap never blocks a critical day; regular holiday days
      // must fit beside the doctor's critical holiday duties.
      if (day.isHoliday && !critical) {
        const regular = (input.regularHolidayByDoctor.get(doc.id) ?? 0) - own
        const criticalHeld = input.criticalHolidayByDoctor.get(doc.id) ?? 0
        if (!holidayCapAllows(regular + 1, criticalHeld)) continue
      }
      if ((yesterdays?.has(doc.id) ?? false) || (tomorrows?.has(doc.id) ?? false)) continue
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

function bump(map: Map<number, number>, id: number): void {
  map.set(id, (map.get(id) ?? 0) + 1)
}

/**
 * Duty tallies of `assignments`. The days just outside the month are seeded
 * from the context so first-day and last-day eligibility respects
 * back-to-back across month boundaries.
 */
function buildDutyMaps(ctx: SchedulingContext, assignments: { date: string; doctorId: number }[]) {
  const holidays = new Set(ctx.days.filter((d) => d.isHoliday).map((d) => d.date))
  const dutiesByDate = new Map<string, Set<number>>()
  const dutyCountByDoctor = new Map<number, number>()
  const regularHolidayByDoctor = new Map<number, number>()
  const criticalHolidayByDoctor = new Map<number, number>()
  const openByDoctor = new Map<number, number>()
  for (const a of assignments) {
    dutiesByDate.set(a.date, (dutiesByDate.get(a.date) ?? new Set<number>()).add(a.doctorId))
    bump(dutyCountByDoctor, a.doctorId)
    if (holidays.has(a.date))
      bump(requiresDoubleCoverage(a.date, ctx.openDuty) ? criticalHolidayByDoctor : regularHolidayByDoctor, a.doctorId)
    if (isOpenDutyDate(a.date, ctx.openDuty.anchorDate, ctx.openDuty.intervalDays))
      bump(openByDoctor, a.doctorId)
  }
  const first = ctx.days[0]?.date
  const last = ctx.days.at(-1)?.date
  if (first) dutiesByDate.set(prevDate(first), new Set(ctx.priorDayDoctorIds))
  if (last) dutiesByDate.set(nextDate(last), new Set(ctx.nextDayDoctorIds))
  return { dutiesByDate, dutyCountByDoctor, regularHolidayByDoctor, criticalHolidayByDoctor, openByDoctor }
}

/** Per-day eligibility answered against `assignments` plus the duties just outside the month. */
function eligibilityFor(ctx: SchedulingContext, assignments: { date: string; doctorId: number }[]): DayInfo[] {
  return computeEligibility({
    doctors: ctx.doctors,
    unavailability: ctx.unavailability,
    days: ctx.days,
    openDuty: ctx.openDuty,
    slots: ctx.slots,
    minimums: ctx.minimums,
    ...buildDutyMaps(ctx, assignments),
  })
}

/** Uniqueness is per clinic (D6): another clinic's schedule for the same month must not block this one. */
async function assertNoSchedule(year: number, month: number, clinicId: number): Promise<void> {
  const exists = await query(
    'SELECT id FROM schedules WHERE year = $1 AND month = $2 AND clinic_id = $3',
    [year, month, clinicId],
  )
  if (exists.rows.length > 0)
    throw new HttpError(409, 'Schedule already exists for this month; delete it first')
}

export const SCHEDULE_OPTION_COUNT = 3

const OPTIONS_CACHE_TTL_MS = 15 * 60_000
const OPTIONS_CACHE_MAX = 20

/** Server-side state that lets an alternative build on the primary option shown on screen. */
interface OptionsCacheEntry {
  ctx: SchedulingContext
  state: PrimaryState
  options: ScheduleOption[]
  /** An alternative came back empty: no other equally good schedule exists. */
  exhausted: boolean
  expiresAt: number
}

// One API process is assumed (see rate-limit.ts); a restart only costs a regenerate (404).
const optionsCache = new Map<string, OptionsCacheEntry>()

function optionsKey(year: number, month: number, clinicId: number): string {
  return `${clinicId}:${year}-${month}`
}

function storeOptions(key: string, entry: OptionsCacheEntry): void {
  const now = Date.now()
  for (const [k, v] of optionsCache) if (v.expiresAt <= now) optionsCache.delete(k)
  optionsCache.delete(key)
  // Map keeps insertion order, so the first key is the oldest entry.
  while (optionsCache.size >= OPTIONS_CACHE_MAX) optionsCache.delete(optionsCache.keys().next().value!)
  optionsCache.set(key, entry)
}

function readOptions(key: string): OptionsCacheEntry {
  const entry = optionsCache.get(key)
  if (!entry || entry.expiresAt <= Date.now()) {
    optionsCache.delete(key)
    throw new HttpError(404, 'Options expired, generate them again')
  }
  return entry
}

/** A busy solver holds the slot for at most its budget; tell callers to retry after that. */
const SOLVER_BUSY_RETRY_SECONDS = Math.ceil(SOLVER_BUDGET_MS / 1000)

/** Maps the solver slot rejection to 429 so callers can retry later. */
async function gated<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof SolverBusyError)
      throw new HttpError(429, 'Solver busy, try again shortly', SOLVER_BUSY_RETRY_SECONDS)
    throw err
  }
}

function doctorSetsByDate(assignments: { date: string; doctorId: number }[]): Map<string, Set<number>> {
  const byDate = new Map<string, Set<number>>()
  for (const a of assignments) {
    const set = byDate.get(a.date) ?? new Set<number>()
    set.add(a.doctorId)
    byDate.set(a.date, set)
  }
  return byDate
}

function changedDatesOf(
  ctx: SchedulingContext,
  base: Map<string, Set<number>>,
  option: Map<string, Set<number>>,
): string[] {
  return ctx.days
    .map((d) => d.date)
    .filter((date) => {
      const a = base.get(date) ?? new Set<number>()
      const b = option.get(date) ?? new Set<number>()
      return a.size !== b.size || [...a].some((id) => !b.has(id))
    })
}

function toOption(entry: OptionsCacheEntry, index: number, result: GenerateResult): ScheduleOption {
  const base = doctorSetsByDate(entry.options[0]?.assignments ?? result.assignments)
  return {
    index,
    assignments: result.assignments,
    conflicts: result.conflicts,
    days: eligibilityFor(entry.ctx, result.assignments),
    changedDates: index === 1 ? [] : changedDatesOf(entry.ctx, base, doctorSetsByDate(result.assignments)),
  }
}

/**
 * Option 1 only; the alternatives are solved on demand by generateAlternative.
 * Read-only like preview: no activity log entry and no usage metering.
 */
export async function generateOptions(
  year: number,
  month: number,
  scope: ClinicScope,
): Promise<ScheduleOptionsResult> {
  await assertNoSchedule(year, month, scope.clinicId)
  const ctx = await buildContext(year, month, scope.clinicId)
  const { result, state } = await gated(() => generatePrimary(ctx))
  const entry: OptionsCacheEntry = {
    ctx,
    state,
    options: [],
    exhausted: false,
    expiresAt: Date.now() + OPTIONS_CACHE_TTL_MS,
  }
  entry.options.push(toOption(entry, 1, result))
  storeOptions(optionsKey(year, month, scope.clinicId), entry)
  return { year, month, options: entry.options, maxOptions: SCHEDULE_OPTION_COUNT, moreAvailable: state.optimal }
}

/** Option `index` (2 or 3), built on the cached primary; options come strictly in order. */
export async function generateAlternative(
  year: number,
  month: number,
  index: number,
  scope: ClinicScope,
): Promise<ScheduleAlternativeResult> {
  await assertNoSchedule(year, month, scope.clinicId)
  const entry = readOptions(optionsKey(year, month, scope.clinicId))
  const moreAvailable = (): boolean =>
    entry.state.optimal && !entry.exhausted && entry.options.length < SCHEDULE_OPTION_COUNT
  const cached = entry.options[index - 1]
  if (cached) return { option: cached, moreAvailable: moreAvailable() }
  if (entry.exhausted) return { option: null, moreAvailable: false }
  if (index > entry.options.length + 1)
    throw new HttpError(400, 'Generate the previous option first')
  const next = await gated(() => runAlternative(entry.ctx, entry.state))
  if (!next) {
    entry.exhausted = true
    return { option: null, moreAvailable: false }
  }
  const option = toOption(entry, index, next.result)
  entry.options.push(option)
  return { option, moreAvailable: moreAvailable() }
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

function validatePlan(ctx: SchedulingContext, assignments: GenerateAssignment[]): PlanDuty[] {
  const activeIds = new Set(ctx.doctors.map((d) => d.id))
  const dayInfo = new Map(ctx.days.map((d) => [d.date, d]))

  const byDate = new Map<string, GenerateAssignment[]>()
  for (const a of assignments) {
    if (!dayInfo.has(a.date))
      throw new HttpError(400, `Assignment date ${a.date} is outside the schedule month`)
    if (!activeIds.has(a.doctorId))
      throw new HttpError(400, `Doctor ${a.doctorId} is not an active doctor`)
    byDate.set(a.date, [...(byDate.get(a.date) ?? []), a])
  }

  // The same hard rules as manual edits, so a plan cannot persist a schedule
  // the administrator could not build by hand. Each duty is judged against
  // all the others, so the order of the plan does not matter.
  for (const [i, a] of assignments.entries()) {
    const others = assignments.filter((_, j) => j !== i)
    const violation = assignmentViolation(ctx, others, a, { checkHolidayCap: false })
    if (violation) throw new HttpError(409, `Constraint violation: ${violation}`)
  }

  for (const [date, arr] of byDate) {
    const max = slotsForDate(date, ctx.openDuty, ctx.slots)
    if (arr.length > max)
      throw new HttpError(
        409,
        `Too many assignments (${arr.length}) for ${date}; max ${max}`,
      )
  }

  const empty = ctx.days.map((d) => d.date).filter((date) => !byDate.has(date))
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

  const holidayViolation = planHolidayViolation(ctx, assignments)
  if (holidayViolation) throw new HttpError(409, `Constraint violation: ${holidayViolation}`)

  return assignments.map((a) => ({
    date: a.date,
    doctorId: a.doctorId,
    isWeekend: dayInfo.get(a.date)!.isWeekend,
    reason: a.reason ?? 'plan',
  }))
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
  assertScheduleVisible(schedule, actor)
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
  const days = eligibilityFor(
    ctx,
    duties.map((d) => ({ date: d.dutyDate, doctorId: d.doctorId })),
  )
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
