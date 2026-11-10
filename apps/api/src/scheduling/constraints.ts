/** On-call slots per day are per clinic (clinics.open/closed_duty_slots); no fixed constant. */

export function isAvailable(
  date: string,
  ranges: Array<{ start: string; end: string }> | undefined,
): boolean {
  return !ranges?.some((r) => r.start <= date && date <= r.end)
}

export function underCap(count: number, maxMonthlyDuties: number): boolean {
  return count < maxMonthlyDuties
}

/** Max duties per doctor on open on-call days per schedule (strict rule). */
export const OPEN_DUTY_DUTY_CAP = 1

export function underOpenDutyCap(count: number): boolean {
  return count < OPEN_DUTY_DUTY_CAP
}

/** Max on-call duties per doctor on holiday days (weekends + marked dates) per month. */
export const HOLIDAY_DUTY_CAP = 2

/**
 * Holiday duties above the cap. Critical holiday duties (open on-call days
 * and the day after) are exempt from the cap but use up room first, so the
 * regular ones may number at most `max(0, cap - critical)`.
 */
export function holidayExcess(regular: number, critical: number): number {
  return Math.max(0, regular - Math.max(0, HOLIDAY_DUTY_CAP - critical))
}

export function holidayCapAllows(regular: number, critical: number): boolean {
  return holidayExcess(regular, critical) === 0
}
