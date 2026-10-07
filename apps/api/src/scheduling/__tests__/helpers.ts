import type { DutyMinimumSettings, DutySlotsSettings } from '@oncall/shared'
import { dayOfWeekISO } from '../dates'
import type { DaySpec, DoctorSpec, SchedulingContext } from '../types'

export function ctx(
  days: DaySpec[],
  doctors: DoctorSpec[],
  opts: {
    unavailability?: Map<number, Array<{ start: string; end: string }>>
    priorDayDoctorIds?: Set<number>
    openDuty?: { anchorDate: string; intervalDays: number }
    slots?: DutySlotsSettings
    minimums?: DutyMinimumSettings
  } = {},
): SchedulingContext {
  // Default per-day capacity matches the seeded production default (2/2/2).
  const slots = opts.slots ?? { openDutySlots: 2, postOpenDutySlots: 2, closedDutySlots: 2 }
  return {
    clinicId: 1,
    year: 2026,
    month: 9,
    days,
    doctors,
    unavailability: opts.unavailability ?? new Map(),
    priorDayDoctorIds: opts.priorDayDoctorIds ?? new Set(),
    openDuty: opts.openDuty ?? { anchorDate: '2030-01-01', intervalDays: 7 },
    slots,
    // Unset minimums mean full coverage, like missing app_meta rows.
    minimums: opts.minimums ?? {
      openDutyMinimum: slots.openDutySlots,
      postOpenDutyMinimum: slots.postOpenDutySlots,
      closedDutyMinimum: slots.closedDutySlots,
    },
  }
}

export const dr = (id: number, max = 7): DoctorSpec => ({
  id,
  firstName: `F${id}`,
  lastName: `L${id}`,
  maxMonthlyDuties: max,
  isActive: true,
})

export const day = (d: string, isWeekend = false, isHoliday = isWeekend): DaySpec => ({
  date: d,
  dayOfWeek: dayOfWeekISO(d),
  isWeekend,
  isHoliday,
})
