import { describe, expect, it } from 'vitest'
import { dayOfWeekISO, daysInMonth, isoDate } from '../dates.ts'
import { assignmentViolation, planHolidayViolation, type HeldDuty } from '../rules.ts'
import { ctx, day, dr } from './helpers.ts'

/** September 2026 (Tue 1st). `marked` weekdays count as holidays like weekends do. */
function september(opts: Parameters<typeof ctx>[2] = {}, marked: string[] = []) {
  const days = Array.from({ length: daysInMonth(2026, 9) }, (_, i) => {
    const date = isoDate(2026, 9, i + 1)
    const weekend = [0, 6].includes(dayOfWeekISO(date))
    return day(date, weekend, weekend || marked.includes(date))
  })
  return ctx(days, [dr(1), dr(2)], {
    minimums: { openDutyMinimum: 1, postOpenDutyMinimum: 1, closedDutyMinimum: 1 },
    ...opts,
  })
}

const held = (doctorId: number, ...dates: string[]): HeldDuty[] => dates.map((date) => ({ date, doctorId }))
const sep = (d: number): string => isoDate(2026, 9, d)

describe('assignmentViolation', () => {
  it('accepts a duty that breaks no rule', () => {
    expect(assignmentViolation(september(), held(1, sep(1), sep(8)), { date: sep(15), doctorId: 1 })).toBeNull()
  })

  it('refuses a second duty on the same date', () => {
    expect(assignmentViolation(september(), held(1, sep(9)), { date: sep(9), doctorId: 1 })).toMatch(
      /already assigned/,
    )
  })

  it('refuses an unavailable doctor', () => {
    const c = september({ unavailability: new Map([[1, [{ start: sep(9), end: sep(11) }]]]) })
    expect(assignmentViolation(c, [], { date: sep(10), doctorId: 1 })).toMatch(/unavailable/)
  })

  it('refuses a duty over the monthly cap', () => {
    const c = september({})
    c.doctors = [dr(1, 2)]
    expect(assignmentViolation(c, held(1, sep(1), sep(3)), { date: sep(8), doctorId: 1 })).toMatch(/monthly cap/)
  })

  it('refuses back-to-back duties on either side', () => {
    const c = september()
    expect(assignmentViolation(c, held(1, sep(9)), { date: sep(10), doctorId: 1 })).toMatch(/back-to-back/)
    expect(assignmentViolation(c, held(1, sep(11)), { date: sep(10), doctorId: 1 })).toMatch(/back-to-back/)
  })

  it('refuses back-to-back across both month boundaries', () => {
    const c = september({ priorDayDoctorIds: new Set([1]), nextDayDoctorIds: new Set([2]) })
    expect(assignmentViolation(c, [], { date: sep(1), doctorId: 1 })).toMatch(/back-to-back/)
    expect(assignmentViolation(c, [], { date: sep(1), doctorId: 2 })).toBeNull()
    expect(assignmentViolation(c, [], { date: sep(30), doctorId: 2 })).toMatch(/back-to-back/)
    expect(assignmentViolation(c, [], { date: sep(30), doctorId: 1 })).toBeNull()
  })

  it('refuses a second open on-call duty', () => {
    // Anchor 09-05, every 7 days: 5 and 12 are open.
    const c = september({ openDuty: { anchorDate: sep(5), intervalDays: 7 } })
    expect(assignmentViolation(c, held(1, sep(5)), { date: sep(12), doctorId: 1 })).toMatch(/open on-call/)
  })

  describe('holiday cap', () => {
    it('counts marked weekday holidays when the new duty falls on a weekend', () => {
      const c = september({}, [sep(9)])
      // Sunday 6th and the marked Wednesday 9th: two holiday duties already.
      expect(assignmentViolation(c, held(1, sep(6), sep(9)), { date: sep(19), doctorId: 1 })).toMatch(
        /holiday cap/,
      )
      expect(assignmentViolation(c, held(1, sep(6)), { date: sep(19), doctorId: 1 })).toBeNull()
    })

    it('never blocks a duty on a critical day', () => {
      // Open Saturdays 5/12/19/26; the Sundays after them are critical too.
      const c = september({ openDuty: { anchorDate: sep(5), intervalDays: 7 } }, [sep(2), sep(9)])
      expect(assignmentViolation(c, held(1, sep(2), sep(9)), { date: sep(20), doctorId: 1 })).toBeNull()
    })

    it('critical holiday duties leave less room for regular ones', () => {
      const c = september({ openDuty: { anchorDate: sep(5), intervalDays: 7 } }, [sep(9), sep(16)])
      // Open Saturday 5th (critical) plus the marked 9th: a third would exceed the cap.
      expect(assignmentViolation(c, held(1, sep(5), sep(9)), { date: sep(16), doctorId: 1 })).toMatch(
        /holiday cap/,
      )
    })

    it('can be left to the plan-level check', () => {
      const c = september({}, [sep(9)])
      expect(
        assignmentViolation(c, held(1, sep(6), sep(9)), { date: sep(19), doctorId: 1 }, { checkHolidayCap: false }),
      ).toBeNull()
    })
  })
})

describe('planHolidayViolation', () => {
  // Marked Tue/Thu holidays, none adjacent: 1st, 3rd, 8th.
  const c = september({}, [sep(1), sep(3), sep(8)])
  const plan = [...held(1, sep(1), sep(3), sep(8)), ...held(2, sep(15))]

  it('accepts over-cap holiday duties when every day holds only its minimum', () => {
    expect(planHolidayViolation(c, plan)).toBeNull()
  })

  it('refuses an over-cap duty on a day that keeps a doctor without it, in any plan order', () => {
    const crowded = [...plan, ...held(2, sep(8))]
    expect(planHolidayViolation(c, crowded)).toMatch(/holiday cap/)
    expect(planHolidayViolation(c, [...crowded].reverse())).toMatch(/holiday cap/)
  })

  it('judges the same duties the same way in any order', () => {
    expect(planHolidayViolation(c, [...plan].reverse())).toBeNull()
  })
})
