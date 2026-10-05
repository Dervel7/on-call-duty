import type { CandidateScore, DaySpec, DoctorSpec } from './types'

export const W_WORKLOAD = 3
export const W_WEEKEND = 4
export const W_FRIDAY = 2
export const W_FRI_SAT_SUN = 5

/** Fair-share duty budget: total weekend/Friday slots split over the pool. */
export function weekendBudget(weekendSlots: number, activeDoctors: number): number {
  return activeDoctors === 0 ? 0 : Math.ceil(weekendSlots / activeDoctors)
}

export function fridayBudget(fridaySlots: number, activeDoctors: number): number {
  return activeDoctors === 0 ? 0 : Math.ceil(fridaySlots / activeDoctors)
}

/**
 * Friday, Saturday or Sunday: the weekdays of the one-each-per-month goal. A
 * marked weekday holiday is not part of the pattern.
 */
export function isFriSatSun(day: DaySpec): boolean {
  return day.dayOfWeek === 5 || day.isWeekend
}

export function scoreCandidate(
  doctor: DoctorSpec,
  day: DaySpec,
  dutiesThisMonth: number,
  weekendDuties: number,
  fridayDuties: number,
  weekendBudgetValue: number,
  fridayBudgetValue: number,
  sameWeekdayDuties: number,
): CandidateScore {
  const workload = (doctor.maxMonthlyDuties - dutiesThisMonth) * W_WORKLOAD
  const weekend = day.isWeekend ? Math.max(0, weekendBudgetValue - weekendDuties) * W_WEEKEND : 0
  const friday = day.dayOfWeek === 5 ? Math.max(0, fridayBudgetValue - fridayDuties) * W_FRIDAY : 0
  // Soft goal: each doctor gets one Friday, one Saturday and one Sunday per month.
  const friSatSun = isFriSatSun(day) && sameWeekdayDuties === 0 ? W_FRI_SAT_SUN : 0
  return { score: workload + weekend + friday + friSatSun, workload, weekend, friday, friSatSun }
}
