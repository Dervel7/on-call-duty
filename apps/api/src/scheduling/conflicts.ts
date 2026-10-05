import { isOpenDutyDate, nextDate, prevDate } from './dates'
import {
  isAvailable,
  notConsecutive,
  underCap,
  underHolidayCap,
  underOpenDutyCap,
} from './constraints'
import type { ConflictPlan, DaySpec, DoctorSpec, SchedulingContext } from './types'

/** Why each doctor of the pool could not take a slot on one day. */
export interface Tally {
  unavailable: number
  'at cap': number
  'at open on-call cap': number
  'at holiday cap': number
  'back-to-back': number
  'already on duty': number
}

export function emptyTally(): Tally {
  return {
    unavailable: 0,
    'at cap': 0,
    'at open on-call cap': 0,
    'at holiday cap': 0,
    'back-to-back': 0,
    'already on duty': 0,
  }
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
): keyof Tally | null {
  if (counts.byDate.get(day.date)?.has(doctor.id)) return 'already on duty'
  if (!isAvailable(doctor.id, day.date, ctx.unavailability.get(doctor.id)).ok) return 'unavailable'
  if (!underCap(counts.total.get(doctor.id) ?? 0, doctor.maxMonthlyDuties).ok) return 'at cap'
  // Strict rule: one open on-call duty per doctor per schedule. A second is
  // never allowed, not even to complete an open day's required coverage.
  if (
    isOpenDutyDate(day.date, ctx.openDuty.anchorDate, ctx.openDuty.intervalDays) &&
    !underOpenDutyCap(counts.openDays.get(doctor.id) ?? 0).ok
  )
    return 'at open on-call cap'
  if (
    day.isHoliday &&
    !critical &&
    !relaxFairness &&
    !underHolidayCap(counts.holiday.get(doctor.id) ?? 0).ok
  )
    return 'at holiday cap'
  // The first day looks at the previous month's last day; the first day of
  // the next month is not checked.
  const onDutyYesterday =
    day.date === ctx.days[0]?.date
      ? ctx.priorDayDoctorIds.has(doctor.id)
      : (counts.byDate.get(prevDate(day.date))?.has(doctor.id) ?? false)
  const onDutyTomorrow = counts.byDate.get(nextDate(day.date))?.has(doctor.id) ?? false
  if (!notConsecutive(onDutyYesterday || onDutyTomorrow).ok) return 'back-to-back'
  return null
}

/** Conflict for a day left below its minimum, with the pool tally as evidence. */
export function conflictFor(
  date: string,
  activeCount: number,
  tally: Tally,
  assigned: number,
  critical: boolean,
  required: number,
): ConflictPlan {
  // Only doctors who already hold one of this day's slots are counted here;
  // keep the detail identical to the classic format otherwise.
  const onDutyNote =
    tally['already on duty'] > 0 ? `, ${tally['already on duty']} already on duty` : ''
  const rule = critical ? `requires ${required} doctors (open on-call rule); ` : ''
  return {
    date,
    detail: `${rule}only ${assigned} of ${required} doctors assigned; of ${activeCount} active doctor(s): ${tally.unavailable} unavailable, ${tally['at cap']} at monthly cap, ${tally['at open on-call cap']} at open on-call cap, ${tally['at holiday cap']} at holiday cap, ${tally['back-to-back']} back-to-back${onDutyNote}`,
  }
}
