import type { DayInfo, DutyMinimumSettings, DutySlotsSettings, OpenDutySettings } from '@oncall/shared'
import { query } from '../db/client.ts'
import {
  daysInMonth,
  dayOfWeekISO,
  holidayCapAllows,
  isAvailable,
  isOpenDutyDate,
  isWeekendISO,
  isoDate,
  minimumForDate,
  nextDate,
  prevDate,
  requiresDoubleCoverage,
  slotsForDate,
  type DoctorSpec,
  type SchedulingContext,
  underCap,
  underOpenDutyCap,
} from '../scheduling/index.ts'
import { getDutyMinimums, getDutySlots, getOpenDutySettings } from './settings.service.ts'

function monthBounds(year: number, month: number): { first: string; last: string } {
  return { first: isoDate(year, month, 1), last: isoDate(year, month, daysInMonth(year, month)) }
}

/**
 * Doctor pool, unavailability and adjacency seeds are all clinic-scoped (§2.6):
 * clinics never interact — a duty in one clinic must not constrain another.
 */
export async function buildContext(
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

/** Calendar shape of `days` with empty doctor lists: day type, slots and minimum. */
export function calendarDays(
  days: { date: string; isWeekend: boolean }[],
  openDuty: OpenDutySettings,
  slots: DutySlotsSettings,
  minimums: DutyMinimumSettings,
): DayInfo[] {
  return days.map((day) => ({
    date: day.date,
    isWeekend: day.isWeekend,
    dutyType: isOpenDutyDate(day.date, openDuty.anchorDate, openDuty.intervalDays) ? 'open' : 'closed',
    slotsRequired: slotsForDate(day.date, openDuty, slots),
    slotsMinimum: minimumForDate(day.date, openDuty, minimums),
    eligibleDoctorIds: [],
    availableDoctorIds: [],
  }))
}

interface EligibilityInput {
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
  const out = calendarDays(input.days, input.openDuty, input.slots, input.minimums)
  for (const [i, day] of input.days.entries()) {
    const info = out[i]!
    const { eligibleDoctorIds: eligible, availableDoctorIds: available } = info
    const isOpen = info.dutyType === 'open'
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
export function eligibilityFor(ctx: SchedulingContext, assignments: { date: string; doctorId: number }[]): DayInfo[] {
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
