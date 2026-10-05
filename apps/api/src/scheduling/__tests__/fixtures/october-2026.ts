import { dayOfWeekISO, daysInMonth, isWeekendISO, isoDate } from '../../dates'
import type { DaySpec, DoctorSpec, SchedulingContext } from '../../types'

/**
 * Main Clinic, October 2026, captured 2026-10-05 (solver design section 7).
 * Doctor ids only; all nine doctors are active with a cap of 7.
 */

const MARKED_HOLIDAYS = new Set(['2026-10-28'])

/** Excluded day ranges per doctor id, inclusive, October 2026. */
const EXCLUSIONS: Record<number, Array<[number, number]>> = {
  1: [[14, 18]],
  2: [[1, 4], [7, 10]],
  3: [[10, 12], [30, 31]],
  4: [[1, 3], [15, 15], [22, 26], [29, 29]],
  5: [[1, 3], [11, 11], [31, 31]],
  6: [[8, 8], [10, 10], [15, 15], [19, 20], [22, 22], [24, 26], [29, 29]],
  7: [[1, 1], [15, 15], [29, 29]],
  8: [[6, 8], [13, 13], [15, 15], [19, 22]],
  9: [[7, 7], [21, 27]],
}

export function october2026(): SchedulingContext {
  const days: DaySpec[] = []
  for (let d = 1; d <= daysInMonth(2026, 10); d++) {
    const date = isoDate(2026, 10, d)
    days.push({
      date,
      dayOfWeek: dayOfWeekISO(date),
      isWeekend: isWeekendISO(date),
      isHoliday: isWeekendISO(date) || MARKED_HOLIDAYS.has(date),
    })
  }
  const doctors: DoctorSpec[] = Array.from({ length: 9 }, (_, i) => ({
    id: i + 1,
    firstName: `F${i + 1}`,
    lastName: `L${i + 1}`,
    maxMonthlyDuties: 7,
    isActive: true,
  }))
  const unavailability = new Map(
    Object.entries(EXCLUSIONS).map(([id, ranges]) => [
      Number(id),
      ranges.map(([start, end]) => ({ start: isoDate(2026, 10, start), end: isoDate(2026, 10, end) })),
    ]),
  )
  return {
    clinicId: 1,
    year: 2026,
    month: 10,
    days,
    doctors,
    unavailability,
    priorDayDoctorIds: new Set(),
    openDuty: { anchorDate: '2026-10-02', intervalDays: 8 },
    slots: { openDutySlots: 2, postOpenDutySlots: 2, closedDutySlots: 2 },
    minimums: { openDutyMinimum: 2, postOpenDutyMinimum: 2, closedDutyMinimum: 1 },
  }
}
