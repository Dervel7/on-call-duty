import type {
  AuthUser,
  CreateDutyRequest,
  DayInfo,
  Duty,
  PreviewResult,
  ReassignDutyRequest,
  ScheduleDetail,
  ScheduleQuery,
  ScheduleSummary,
  ScheduleStatus,
} from '@oncall/shared'
import { query, withTransaction } from '../db/client'
import { HttpError } from '../lib/http-error'
import { generate as runEngine, isAvailable, notConsecutive, underCap, MAX_SATURDAY_DUTIES, MAX_SUNDAY_DUTIES, DOCTORS_PER_DAY } from '../scheduling'
import {
  daysInMonth,
  dayOfWeekISO,
  inMonth,
  isWeekendISO,
  isoDate,
  nextDate,
  prevDate,
} from '../scheduling/dates'
import type { DoctorSpec, SchedulingContext } from '../scheduling/types'

type Actor = Pick<AuthUser, 'id' | 'role'>

interface ScheduleRow {
  id: number
  year: number
  month: number
  status: string
  created_by: number | null
  created_at: Date
  updated_at: Date
}

interface DutyRow {
  id: number
  schedule_id: number
  duty_date: string
  doctor_id: number
  first_name: string
  last_name: string
  is_weekend: boolean
  is_holiday: boolean
  reason: string
  created_at: Date
  schedule_status: string
}

const SELECT_SCHEDULE = `SELECT id, year, month, status, created_by, created_at, updated_at FROM schedules`
const SELECT_DUTY = `SELECT du.id, du.schedule_id, du.duty_date, du.doctor_id, du.is_weekend,
  du.is_holiday, du.reason, du.created_at, u.first_name, u.last_name, s.status AS schedule_status
  FROM duties du JOIN doctors d ON d.id = du.doctor_id JOIN users u ON u.id = d.user_id
  JOIN schedules s ON s.id = du.schedule_id`

function toSchedule(row: ScheduleRow): ScheduleSummary {
  return {
    id: row.id,
    year: row.year,
    month: row.month,
    status: row.status as ScheduleStatus,
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
    isHoliday: row.is_holiday,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
  }
}

function monthBounds(year: number, month: number): { first: string; last: string } {
  return { first: isoDate(year, month, 1), last: isoDate(year, month, daysInMonth(year, month)) }
}

async function buildContext(year: number, month: number): Promise<SchedulingContext> {
  const { first, last } = monthBounds(year, month)

  const dr = await query<{
    id: number
    max_monthly_duties: number
    first_name: string
    last_name: string
  }>(
    `SELECT d.id, d.max_monthly_duties, u.first_name, u.last_name
     FROM doctors d JOIN users u ON u.id = d.user_id
     WHERE u.is_active = TRUE ORDER BY d.id`,
  )
  const doctors: DoctorSpec[] = dr.rows.map((r) => ({
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    maxMonthlyDuties: r.max_monthly_duties,
    isActive: true,
  }))

  const hres = await query<{ date: string }>(
    `SELECT date FROM holidays WHERE date >= $1 AND date <= $2`,
    [first, last],
  )
  const holidays = new Set(hres.rows.map((r) => r.date))

  const ures = await query<{ doctor_id: number; start_date: string; end_date: string }>(
    `SELECT doctor_id, start_date, end_date FROM unavailability
     WHERE start_date <= $1 AND end_date >= $2`,
    [last, first],
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
    days.push({ date, dayOfWeek: dayOfWeekISO(date), isWeekend: isWeekendISO(date), isHoliday: holidays.has(date) })
  }

  const firstDayPrev = prevDate(first)
  const pres = await query<{ doctor_id: number }>(`SELECT doctor_id FROM duties WHERE duty_date = $1`, [
    firstDayPrev,
  ])
  const priorDayDoctorIds = new Set(pres.rows.map((r) => r.doctor_id))

  return { year, month, days, doctors, unavailability, priorDayDoctorIds }
}

export interface EligibilityInput {
  doctors: DoctorSpec[]
  unavailability: Map<number, Array<{ start: string; end: string }>>
  days: { date: string; dayOfWeek: number; isWeekend: boolean; isHoliday: boolean }[]
  dutiesByDate: Map<string, Set<number>>
  dutyCountByDoctor: Map<number, number>
  saturdayByDoctor: Map<number, number>
  sundayByDoctor: Map<number, number>
}

export function computeEligibility(input: EligibilityInput): DayInfo[] {
  const out: DayInfo[] = []
  for (const day of input.days) {
    const eligible: number[] = []
    const todays = input.dutiesByDate.get(day.date) ?? new Set<number>()
    const yesterdays = input.dutiesByDate.get(prevDate(day.date))
    const tomorrows = input.dutiesByDate.get(nextDate(day.date))
    for (const doc of input.doctors) {
      const ranges = input.unavailability.get(doc.id)
      if (!isAvailable(doc.id, day.date, ranges).ok) continue
      const assignedToday = todays.has(doc.id)
      const count = (input.dutyCountByDoctor.get(doc.id) ?? 0) - (assignedToday ? 1 : 0)
      if (!underCap(count, doc.maxMonthlyDuties).ok) continue
      if (day.dayOfWeek === 6 && !underCap(input.saturdayByDoctor.get(doc.id) ?? 0, MAX_SATURDAY_DUTIES).ok)
        continue
      if (day.dayOfWeek === 0 && !underCap(input.sundayByDoctor.get(doc.id) ?? 0, MAX_SUNDAY_DUTIES).ok)
        continue
      const onDutyAdjacent =
        (yesterdays?.has(doc.id) ?? false) || (tomorrows?.has(doc.id) ?? false)
      if (!notConsecutive(onDutyAdjacent).ok) continue
      eligible.push(doc.id)
    }
    out.push({
      date: day.date,
      isWeekend: day.isWeekend,
      isHoliday: day.isHoliday,
      eligibleDoctorIds: eligible,
    })
  }
  return out
}

export async function preview(year: number, month: number): Promise<PreviewResult> {
  const ctx = await buildContext(year, month)
  const result = runEngine(ctx)
  const dutiesByDate = new Map<string, Set<number>>()
  const dutyCountByDoctor = new Map<number, number>()
  const saturdayByDoctor = new Map<number, number>()
  const sundayByDoctor = new Map<number, number>()
  for (const a of result.assignments) {
    const set = dutiesByDate.get(a.date) ?? new Set<number>()
    set.add(a.doctorId)
    dutiesByDate.set(a.date, set)
    dutyCountByDoctor.set(a.doctorId, (dutyCountByDoctor.get(a.doctorId) ?? 0) + 1)
    const dow = dayOfWeekISO(a.date)
    if (dow === 6) saturdayByDoctor.set(a.doctorId, (saturdayByDoctor.get(a.doctorId) ?? 0) + 1)
    if (dow === 0) sundayByDoctor.set(a.doctorId, (sundayByDoctor.get(a.doctorId) ?? 0) + 1)
  }
  const days = computeEligibility({
    doctors: ctx.doctors,
    unavailability: ctx.unavailability,
    days: ctx.days,
    dutiesByDate,
    dutyCountByDoctor,
    saturdayByDoctor,
    sundayByDoctor,
  }).map((d) => ({ ...d, eligibleDoctorIds: [] }))
  return { assignments: result.assignments, conflicts: result.conflicts, days }
}

export async function generate(
  year: number,
  month: number,
  actor: Actor,
): Promise<ScheduleDetail> {
  const exists = await query('SELECT id FROM schedules WHERE year = $1 AND month = $2', [
    year,
    month,
  ])
  if (exists.rows.length > 0)
    throw new HttpError(409, 'Schedule already exists for this month; delete it first')

  const ctx = await buildContext(year, month)
  const result = runEngine(ctx)
  if (result.conflicts.length > 0)
    throw new HttpError(
      422,
      `Schedule has ${result.conflicts.length} unfillable day(s); run /schedules/preview for details`,
    )

  const scheduleId = await withTransaction(async (client) => {
    const ins = await client.query<{ id: number }>(
      `INSERT INTO schedules (year, month, status, created_by) VALUES ($1, $2, 'draft', $3) RETURNING id`,
      [year, month, actor.id],
    )
    const id = ins.rows[0]?.id
    if (id === undefined) throw new HttpError(500, 'Failed to create schedule')
    for (const a of result.assignments) {
      await client.query(
        `INSERT INTO duties (schedule_id, duty_date, doctor_id, is_weekend, is_holiday, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, a.date, a.doctorId, a.isWeekend, a.isHoliday, a.reason],
      )
    }
    return id
  })
  return getById(scheduleId, actor)
}

export async function list(
  filters: ScheduleQuery = {},
  actor?: Actor,
): Promise<ScheduleSummary[]> {
  const where: string[] = []
  const params: unknown[] = []
  if (actor && actor.role !== 'administrator') {
    params.push('published')
    where.push(`status = $${params.length}`)
  }
  if (filters.year !== undefined) {
    params.push(filters.year)
    where.push(`year = $${params.length}`)
  }
  if (filters.month !== undefined) {
    params.push(filters.month)
    where.push(`month = $${params.length}`)
  }
  const sql =
    where.length > 0
      ? `${SELECT_SCHEDULE} WHERE ${where.join(' AND ')} ORDER BY year DESC, month DESC`
      : `${SELECT_SCHEDULE} ORDER BY year DESC, month DESC`
  const res = await query<ScheduleRow>(sql, params)
  return res.rows.map(toSchedule)
}

export async function getScheduleDuties(
  id: number,
): Promise<{ schedule: ScheduleSummary; duties: Duty[] }> {
  const sres = await query<ScheduleRow>(`${SELECT_SCHEDULE} WHERE id = $1`, [id])
  const schedule = sres.rows[0]
  if (!schedule) throw new HttpError(404, 'Schedule not found')
  const dres = await query<DutyRow>(`${SELECT_DUTY} WHERE du.schedule_id = $1 ORDER BY du.duty_date`, [
    id,
  ])
  return { schedule: toSchedule(schedule), duties: dres.rows.map(toDuty) }
}

export async function getById(id: number, actor?: Actor): Promise<ScheduleDetail> {
  const { schedule, duties } = await getScheduleDuties(id)
  const isAdmin = actor?.role === 'administrator'
  if (actor && !isAdmin && schedule.status !== 'published') {
    throw new HttpError(403, 'Schedule not published')
  }
  const ctx = await buildContext(schedule.year, schedule.month)
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
  let days = computeEligibility({
    doctors: ctx.doctors,
    unavailability: ctx.unavailability,
    days: ctx.days,
    dutiesByDate,
    dutyCountByDoctor,
    saturdayByDoctor,
    sundayByDoctor,
  })
  if (!isAdmin) {
    days = days.map((d) => ({ ...d, eligibleDoctorIds: [] }))
  }
  return { schedule, duties, days }
}

export async function remove(id: number): Promise<void> {
  const existing = await query<{ status: string }>(
    'SELECT status FROM schedules WHERE id = $1',
    [id],
  )
  if (existing.rows.length === 0) throw new HttpError(404, 'Schedule not found')
  assertEditable(
    existing.rows[0]!.status,
    'Schedule is published; revert to draft before deleting',
  )
  await query('DELETE FROM schedules WHERE id = $1', [id])
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

async function validateAssignment(
  scheduleId: number,
  doctorId: number,
  date: string,
  excludeDutyId: number | null,
): Promise<void> {
  const dr = await query<{ max_monthly_duties: number; is_active: boolean }>(
    `SELECT d.max_monthly_duties, u.is_active FROM doctors d JOIN users u ON u.id = d.user_id WHERE d.id = $1`,
    [doctorId],
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

  const dow = dayOfWeekISO(date)
  if (dow === 6 || dow === 0) {
    const wkRes = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM duties
       WHERE schedule_id = $1 AND doctor_id = $2 AND is_weekend AND ($3::int IS NULL OR id <> $3)
       AND EXTRACT(ISODOW FROM duty_date) = $4`,
      [scheduleId, doctorId, excludeDutyId, dow === 6 ? 6 : 7],
    )
    const cap = dow === 6 ? MAX_SATURDAY_DUTIES : MAX_SUNDAY_DUTIES
    if (!underCap(wkRes.rows[0]?.n ?? 0, cap).ok)
      throw new HttpError(409, `Constraint violation: ${dow === 6 ? 'saturday' : 'sunday'} cap reached`)
  }

  const prev = prevDate(date)
  const next = nextDate(date)
  const nb = await query<{ doctor_id: number }>(
    `SELECT doctor_id FROM duties WHERE duty_date IN ($1, $2)`,
    [prev, next],
  )
  const onDutyAdjacent = nb.rows.some((r) => r.doctor_id === doctorId)
  if (!notConsecutive(onDutyAdjacent).ok)
    throw new HttpError(409, 'Constraint violation: back-to-back')
}

async function isHolidayOn(date: string): Promise<boolean> {
  const res = await query('SELECT 1 FROM holidays WHERE date = $1', [date])
  return res.rows.length > 0
}

function assertEditable(
  status: string,
  message = 'Schedule is published; revert to draft to edit',
): void {
  if (status === 'published') throw new HttpError(409, message)
}

export async function addDuty(
  scheduleId: number,
  input: CreateDutyRequest,
  actor: Actor,
): Promise<Duty> {
  const sres = await query<ScheduleRow>(`${SELECT_SCHEDULE} WHERE id = $1`, [scheduleId])
  const schedule = sres.rows[0]
  if (!schedule) throw new HttpError(404, 'Schedule not found')
  if (!inMonth(input.date, schedule.year, schedule.month))
    throw new HttpError(400, 'Date is outside this schedule month')

  assertEditable(schedule.status)

  const existing = await query<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM duties WHERE schedule_id = $1 AND duty_date = $2',
    [scheduleId, input.date],
  )
  if ((existing.rows[0]?.n ?? 0) >= DOCTORS_PER_DAY)
    throw new HttpError(409, 'Both on-call slots for this date are already filled')

  await validateAssignment(scheduleId, input.doctorId, input.date, null)

  const reason = `manual override by admin #${actor.id}`
  const ins = await query<{ id: number }>(
    `INSERT INTO duties (schedule_id, duty_date, doctor_id, is_weekend, is_holiday, reason)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      scheduleId,
      input.date,
      input.doctorId,
      isWeekendISO(input.date),
      await isHolidayOn(input.date),
      reason,
    ],
  )
  const id = ins.rows[0]?.id
  if (id === undefined) throw new HttpError(500, 'Failed to create duty')
  return getDutyById(id)
}

export async function reassignDuty(
  dutyId: number,
  input: ReassignDutyRequest,
  actor: Actor,
): Promise<Duty> {
  const duty = await getDutyRow(dutyId)
  assertEditable(duty.schedule_status)
  await validateAssignment(duty.schedule_id, input.doctorId, duty.duty_date, dutyId)
  const reason = `manual override by admin #${actor.id}`
  await query('UPDATE duties SET doctor_id = $1, reason = $2 WHERE id = $3', [
    input.doctorId,
    reason,
    dutyId,
  ])
  return getDutyById(dutyId)
}

export async function removeDuty(dutyId: number): Promise<void> {
  const duty = await getDutyRow(dutyId)
  assertEditable(duty.schedule_status)
  await query('DELETE FROM duties WHERE id = $1', [dutyId])
}

export async function publish(id: number): Promise<ScheduleSummary> {
  const upd = await query<ScheduleRow>(
    `UPDATE schedules SET status = 'published', updated_at = NOW()
     WHERE id = $1 AND status = 'draft'
     RETURNING id, year, month, status, created_by, created_at, updated_at`,
    [id],
  )
  if (upd.rows.length === 0) {
    const found = await query('SELECT 1 FROM schedules WHERE id = $1', [id])
    if (found.rows.length === 0) throw new HttpError(404, 'Schedule not found')
    throw new HttpError(409, 'Schedule is already published')
  }
  return toSchedule(upd.rows[0]!)
}

export async function unpublish(id: number): Promise<ScheduleSummary> {
  const upd = await query<ScheduleRow>(
    `UPDATE schedules SET status = 'draft', updated_at = NOW()
     WHERE id = $1 AND status = 'published'
     RETURNING id, year, month, status, created_by, created_at, updated_at`,
    [id],
  )
  if (upd.rows.length === 0) {
    const found = await query('SELECT 1 FROM schedules WHERE id = $1', [id])
    if (found.rows.length === 0) throw new HttpError(404, 'Schedule not found')
    throw new HttpError(409, 'Schedule is already draft')
  }
  return toSchedule(upd.rows[0]!)
}
