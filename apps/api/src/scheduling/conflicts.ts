import { isOpenDutyDate, nextDate, prevDate } from './dates'
import {
  isAvailable,
  notConsecutive,
  underCap,
  underHolidayCap,
  underOpenDutyCap,
} from './constraints'
import type { ConflictTally, DaySpec, DoctorSpec, SchedulingContext } from './types'

export function emptyTally(): ConflictTally {
  return { unavailable: 0, atMonthlyCap: 0, atOpenDutyCap: 0, atHolidayCap: 0, backToBack: 0, alreadyOnDuty: 0 }
}

/** Duties held so far (greedy) or in the final solution (solver). */
export interface DutyCounts {
  byDate: Map<string, Set<number>>
  total: Map<number, number>
  openDays: Map<number, number>
  holiday: Map<number, number>
}

/**
 * First rule that keeps `doctor` off `day`, or null when the doctor may take
 * it. The order is the conflict-report order shared by the greedy engine and
 * the solver. `critical` days (open on-call days and the day after) and
 * `relaxFairness` skip the holiday cap; hard rules always apply.
 */
export function blockingRule(
  ctx: SchedulingContext,
  counts: DutyCounts,
  doctor: DoctorSpec,
  day: DaySpec,
  critical: boolean,
  relaxFairness: boolean,
): keyof ConflictTally | null {
  if (counts.byDate.get(day.date)?.has(doctor.id)) return 'alreadyOnDuty'
  if (!isAvailable(doctor.id, day.date, ctx.unavailability.get(doctor.id)).ok) return 'unavailable'
  if (!underCap(counts.total.get(doctor.id) ?? 0, doctor.maxMonthlyDuties).ok) return 'atMonthlyCap'
  // Strict rule: one open on-call duty per doctor per schedule. A second is
  // never allowed, not even to complete an open day's required coverage.
  if (
    isOpenDutyDate(day.date, ctx.openDuty.anchorDate, ctx.openDuty.intervalDays) &&
    !underOpenDutyCap(counts.openDays.get(doctor.id) ?? 0).ok
  )
    return 'atOpenDutyCap'
  if (
    day.isHoliday &&
    !critical &&
    !relaxFairness &&
    !underHolidayCap(counts.holiday.get(doctor.id) ?? 0).ok
  )
    return 'atHolidayCap'
  // The first day looks at the previous month's last day; the first day of
  // the next month is not checked.
  const onDutyYesterday =
    day.date === ctx.days[0]?.date
      ? ctx.priorDayDoctorIds.has(doctor.id)
      : (counts.byDate.get(prevDate(day.date))?.has(doctor.id) ?? false)
  const onDutyTomorrow = counts.byDate.get(nextDate(day.date))?.has(doctor.id) ?? false
  if (!notConsecutive(onDutyYesterday || onDutyTomorrow).ok) return 'backToBack'
  return null
}
