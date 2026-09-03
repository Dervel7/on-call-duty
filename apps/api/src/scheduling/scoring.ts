import { DOCTORS_PER_DAY } from './constraints'
import type { CandidateScore, DaySpec, DoctorSpec } from './types'

export const W_WORKLOAD = 3
export const W_WEEKEND = 4
export const W_HOLIDAY = 4
export const W_FRIDAY = 2

export function weekendBudget(weekendDays: number, activeDoctors: number): number {
  return activeDoctors === 0 ? 0 : Math.ceil((DOCTORS_PER_DAY * weekendDays) / activeDoctors)
}

export function holidayBudget(holidayDays: number, activeDoctors: number): number {
  return activeDoctors === 0 ? 0 : Math.ceil((DOCTORS_PER_DAY * holidayDays) / activeDoctors)
}

export function fridayBudget(fridayDays: number, activeDoctors: number): number {
  return activeDoctors === 0 ? 0 : Math.ceil((DOCTORS_PER_DAY * fridayDays) / activeDoctors)
}

export function scoreCandidate(
  doctor: DoctorSpec,
  day: DaySpec,
  dutiesThisMonth: number,
  weekendDuties: number,
  holidayDuties: number,
  fridayDuties: number,
  weekendBudgetValue: number,
  holidayBudgetValue: number,
  fridayBudgetValue: number,
): CandidateScore {
  const workload = (doctor.maxMonthlyDuties - dutiesThisMonth) * W_WORKLOAD
  const weekend = day.isWeekend ? Math.max(0, weekendBudgetValue - weekendDuties) * W_WEEKEND : 0
  const holiday = day.isHoliday ? Math.max(0, holidayBudgetValue - holidayDuties) * W_HOLIDAY : 0
  const friday = day.dayOfWeek === 5 ? Math.max(0, fridayBudgetValue - fridayDuties) * W_FRIDAY : 0
  return { score: workload + weekend + holiday + friday, workload, weekend, holiday, friday }
}
