import { isOpenDutyDate, nextDate, prevDate } from './dates.ts'
import { holidayCapAllows, isAvailable, underCap, underOpenDutyCap } from './constraints.ts'
import type { ConflictTally, DaySpec, DoctorSpec, SchedulingContext } from './types.ts'

export function emptyTally(): ConflictTally {
  return { unavailable: 0, atMonthlyCap: 0, atOpenDutyCap: 0, backToBack: 0, alreadyOnDuty: 0 }
}

export type BlockingRule = keyof ConflictTally | 'atHolidayCap'

/** The holiday cap blocks an optional slot only; the conflict report covers required slots, so it has no tally entry. */
export function countBlock(tally: ConflictTally, rule: BlockingRule): void {
  if (rule !== 'atHolidayCap') tally[rule]++
}

/** Duties held so far (greedy) or in the final solution (solver). */
export interface DutyCounts {
  byDate: Map<string, Set<number>>
  total: Map<number, number>
  openDays: Map<number, number>
  /** Duties on non-critical holiday days. */
  holiday: Map<number, number>
  /** Duties on critical holiday days. */
  criticalHoliday: Map<number, number>
}

/**
 * First rule that keeps `doctor` off `day`, or null when the doctor may take
 * it. The order is the conflict-report order shared by the greedy engine and
 * the solver. A `critical` day (open on-call day or the day after) skips the
 * holiday cap while `required` coverage needs it; an optional critical slot
 * only fits when the doctor's regular holiday duties still fit beside it.
 * `relaxFairness` skips the holiday cap; hard rules always apply.
 */
export function blockingRule(
  ctx: SchedulingContext,
  counts: DutyCounts,
  doctor: DoctorSpec,
  day: DaySpec,
  critical: boolean,
  relaxFairness: boolean,
  required = true,
): BlockingRule | null {
  if (counts.byDate.get(day.date)?.has(doctor.id)) return 'alreadyOnDuty'
  if (!isAvailable(day.date, ctx.unavailability.get(doctor.id))) return 'unavailable'
  if (!underCap(counts.total.get(doctor.id) ?? 0, doctor.maxMonthlyDuties)) return 'atMonthlyCap'
  // Strict rule: one open on-call duty per doctor per schedule. A second is
  // never allowed, not even to complete an open day's required coverage.
  if (
    isOpenDutyDate(day.date, ctx.openDuty.anchorDate, ctx.openDuty.intervalDays) &&
    !underOpenDutyCap(counts.openDays.get(doctor.id) ?? 0)
  )
    return 'atOpenDutyCap'
  if (day.isHoliday && !relaxFairness) {
    const regular = counts.holiday.get(doctor.id) ?? 0
    const criticalHeld = counts.criticalHoliday.get(doctor.id) ?? 0
    const fits = critical
      ? required || holidayCapAllows(regular, criticalHeld + 1)
      : holidayCapAllows(regular + 1, criticalHeld)
    if (!fits) return 'atHolidayCap'
  }
  // The first and last day also look at the neighbouring months' duties.
  const onDutyYesterday =
    day.date === ctx.days[0]?.date
      ? ctx.priorDayDoctorIds.has(doctor.id)
      : (counts.byDate.get(prevDate(day.date))?.has(doctor.id) ?? false)
  const onDutyTomorrow =
    day.date === ctx.days.at(-1)?.date
      ? ctx.nextDayDoctorIds.has(doctor.id)
      : (counts.byDate.get(nextDate(day.date))?.has(doctor.id) ?? false)
  if (onDutyYesterday || onDutyTomorrow) return 'backToBack'
  return null
}
