import type { CandidateScore, DaySpec, DoctorSpec } from './types'

export const W_WORKLOAD = 3
export const W_WEEKEND = 4
export const W_FRIDAY = 2

/** Fair-share duty budget: total weekend/Friday slots split over the pool. */
export function weekendBudget(weekendSlots: number, activeDoctors: number): number {
  return activeDoctors === 0 ? 0 : Math.ceil(weekendSlots / activeDoctors)
}

export function fridayBudget(fridaySlots: number, activeDoctors: number): number {
  return activeDoctors === 0 ? 0 : Math.ceil(fridaySlots / activeDoctors)
}

export function scoreCandidate(
  doctor: DoctorSpec,
  day: DaySpec,
  dutiesThisMonth: number,
  weekendDuties: number,
  fridayDuties: number,
  weekendBudgetValue: number,
  fridayBudgetValue: number,
): CandidateScore {
  const workload = (doctor.maxMonthlyDuties - dutiesThisMonth) * W_WORKLOAD
  const weekend = day.isWeekend ? Math.max(0, weekendBudgetValue - weekendDuties) * W_WEEKEND : 0
  const friday = day.dayOfWeek === 5 ? Math.max(0, fridayBudgetValue - fridayDuties) * W_FRIDAY : 0
  return { score: workload + weekend + friday, workload, weekend, friday }
}
