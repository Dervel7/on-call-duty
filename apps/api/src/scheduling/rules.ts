import { isOpenDutyDate, minimumForDate, nextDate, prevDate, requiresDoubleCoverage } from './dates.ts'
import {
  HOLIDAY_DUTY_CAP,
  OPEN_DUTY_DUTY_CAP,
  holidayCapAllows,
  isAvailable,
  underCap,
  underOpenDutyCap,
} from './constraints.ts'
import type { SchedulingContext } from './types.ts'

/** A duty already held, or a candidate one. */
export interface HeldDuty {
  date: string
  doctorId: number
}

const holidayMessage = (doctorId: number): string =>
  `doctor ${doctorId} exceeds the holiday cap of ${HOLIDAY_DUTY_CAP} duties on holiday days`

/** Holiday dates of `dates` split by whether the cap applies to them. */
function holidaySplit(
  ctx: SchedulingContext,
  dates: readonly string[],
): { regular: string[]; critical: string[] } {
  const holidays = new Set(ctx.days.filter((d) => d.isHoliday).map((d) => d.date))
  const onHoliday = dates.filter((date) => holidays.has(date))
  return {
    regular: onHoliday.filter((date) => !requiresDoubleCoverage(date, ctx.openDuty)),
    critical: onHoliday.filter((date) => requiresDoubleCoverage(date, ctx.openDuty)),
  }
}

/**
 * First hard rule broken by adding `candidate` to `duties` (the duties of the
 * month without the one being replaced), or null. One implementation for
 * every manual edit and every saved plan; the order matches the engine's
 * conflict order. `checkHolidayCap: false` leaves the holiday cap to
 * `planHolidayViolation`, which judges a whole plan on its final counts.
 * Holiday duties on critical days (open on-call days and the day after) are
 * exempt from the cap.
 */
export function assignmentViolation(
  ctx: SchedulingContext,
  duties: readonly HeldDuty[],
  candidate: HeldDuty,
  { checkHolidayCap = true }: { checkHolidayCap?: boolean } = {},
): string | null {
  const { date, doctorId } = candidate
  const doctor = ctx.doctors.find((d) => d.id === doctorId)
  if (!doctor) return `doctor ${doctorId} is not an active doctor`
  const mine = duties.filter((d) => d.doctorId === doctorId).map((d) => d.date)
  if (mine.includes(date)) return `doctor ${doctorId} already assigned to ${date}`
  if (!isAvailable(date, ctx.unavailability.get(doctorId))) return `doctor ${doctorId} unavailable on ${date}`
  if (!underCap(mine.length, doctor.maxMonthlyDuties))
    return `doctor ${doctorId} exceeds the monthly cap of ${doctor.maxMonthlyDuties} duties`
  const isOpen = (d: string): boolean => isOpenDutyDate(d, ctx.openDuty.anchorDate, ctx.openDuty.intervalDays)
  if (isOpen(date) && !underOpenDutyCap(mine.filter(isOpen).length))
    return `doctor ${doctorId} exceeds the limit of ${OPEN_DUTY_DUTY_CAP} duty on open on-call days`
  if (checkHolidayCap && holidaySplit(ctx, [date]).regular.length === 1) {
    const held = holidaySplit(ctx, mine)
    if (!holidayCapAllows(held.regular.length + 1, held.critical.length)) return holidayMessage(doctorId)
  }
  const previous = date === ctx.days[0]?.date ? ctx.priorDayDoctorIds.has(doctorId) : mine.includes(prevDate(date))
  const following =
    date === ctx.days.at(-1)?.date ? ctx.nextDayDoctorIds.has(doctorId) : mine.includes(nextDate(date))
  if (previous || following) return `doctor ${doctorId} would be on duty back-to-back on ${date}`
  return null
}

/**
 * Holiday cap of a whole plan, judged on final per-doctor counts so the
 * outcome does not depend on the order of the plan. A doctor's regular
 * holiday duties beyond the cap (the chronologically last ones) are accepted
 * only on days that hold no more than their minimum: removing such a duty
 * would leave the day short, so the minimum-coverage rule outranks fairness.
 */
export function planHolidayViolation(ctx: SchedulingContext, plan: readonly HeldDuty[]): string | null {
  const perDate = new Map<string, number>()
  for (const d of plan) perDate.set(d.date, (perDate.get(d.date) ?? 0) + 1)
  for (const doctorId of new Set(plan.map((d) => d.doctorId))) {
    const dates = plan.filter((d) => d.doctorId === doctorId).map((d) => d.date).sort()
    const held = holidaySplit(ctx, dates)
    const over = held.regular.slice(Math.max(0, HOLIDAY_DUTY_CAP - held.critical.length))
    if (over.some((date) => (perDate.get(date) ?? 0) > minimumForDate(date, ctx.openDuty, ctx.minimums)))
      return holidayMessage(doctorId)
  }
  return null
}
