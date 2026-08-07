import type { CandidateScore, DaySpec, DoctorSpec } from './types'

export const W_WORKLOAD = 3
export const W_WEEKEND = 4
export const W_HOLIDAY = 4

export function weekendBudget(weekendDays: number, activeDoctors: number): number {
  return activeDoctors === 0 ? 0 : Math.ceil(weekendDays / activeDoctors)
}

export function holidayBudget(holidayDays: number, activeDoctors: number): number {
  return activeDoctors === 0 ? 0 : Math.ceil(holidayDays / activeDoctors)
}

export function scoreCandidate(
  doctor: DoctorSpec,
  day: DaySpec,
  dutiesThisMonth: number,
  weekendDuties: number,
  holidayDuties: number,
  weekendBudgetValue: number,
  holidayBudgetValue: number,
): CandidateScore {
  const workload = (doctor.maxMonthlyDuties - dutiesThisMonth) * W_WORKLOAD
  const weekend = day.isWeekend ? Math.max(0, weekendBudgetValue - weekendDuties) * W_WEEKEND : 0
  const holiday = day.isHoliday ? Math.max(0, holidayBudgetValue - holidayDuties) * W_HOLIDAY : 0
  return { score: workload + weekend + holiday, workload, weekend, holiday }
}
