import { describe, expect, it } from 'vitest'
import { HOLIDAY_DUTY_CAP, OPEN_DUTY_DUTY_CAP } from '../constraints.ts'
import { dayOfWeekISO, nextDate } from '../dates.ts'
import { isFriSatSun } from '../scoring.ts'
import { buildModel, capacityOf, indexModel, type Stage } from '../solver-model.ts'
import { ctx, day, dr } from './helpers.ts'

// Tue 1, Wed 2, Thu 3 September 2026; anchor 09-01 every 2 days: 1 and 3 are
// open, 2 is the day after an open day. Doctor 2 is away on the 2nd, doctor 3
// held the previous month's last day.
const model = indexModel(
  ctx([day('2026-09-01'), day('2026-09-02'), day('2026-09-03')], [dr(3), dr(1), dr(2)], {
    unavailability: new Map([[2, [{ start: '2026-09-02', end: '2026-09-02' }]]]),
    priorDayDoctorIds: new Set([3]),
    openDuty: { anchorDate: '2026-09-01', intervalDays: 2 },
  }),
)
const lp = buildModel(model, 'fill', { optima: new Map(), capacity: new Map() }) ?? ''
const variables = new Set(lp.match(/\bx_\d+_\d{8}\b/g))

describe('solver model', () => {
  it('has a variable only where the doctor may be assigned', () => {
    expect([...variables].sort()).toEqual([
      'x_1_20260901',
      'x_1_20260902',
      'x_1_20260903',
      'x_2_20260901',
      'x_2_20260903',
      'x_3_20260902',
      'x_3_20260903',
    ])
  })

  it('forbids back-to-back days and a second open on-call day', () => {
    expect(lp).toMatch(/^ b2b_1_20260901: x_1_20260901 \+ x_1_20260902 <= 1$/m)
    expect(lp).toMatch(/^ b2b_1_20260902: x_1_20260902 \+ x_1_20260903 <= 1$/m)
    // Doctor 2 has no duty possible on the 2nd, so no pair to forbid.
    expect(lp).not.toMatch(/^ b2b_2_/m)
    expect(lp).toMatch(/^ open_1: x_1_20260901 \+ x_1_20260903 <= 1$/m)
    expect(lp).toMatch(/^ open_2: x_2_20260901 \+ x_2_20260903 <= 1$/m)
  })

  it('skips a stage with nothing to optimize', () => {
    // No Friday, Saturday or Sunday in the month.
    expect(buildModel(model, 'weekdays', { optima: new Map(), capacity: new Map() })).toBeNull()
  })

  describe('alternative stage', () => {
    // Every day is critical (open or after open): two cover stages, and
    // `relax`, `weekdays` and `holidays` have no terms in this month.
    const optima = new Map<Stage, number>([
      ['cover-critical-1', 0],
      ['cover-critical-2', 1],
      ['share', 2],
      ['fill', 5],
    ])
    const capacity = new Map([[1, 2], [2, 1], [3, 1]])
    const first = new Set(['x_3_20260902', 'x_1_20260901', 'x_2_20260903'])
    const alternative = (avoid: ReadonlySet<string>[]): string =>
      buildModel(model, 'alternative', { optima, capacity, avoid }) ?? ''

    it('keeps every stage optimum and excludes the earlier option', () => {
      const text = alternative([first])
      expect(text.match(/^ bound_\w+(?=:)/gm)?.map((r) => r.trim()).sort()).toEqual([
        'bound_cover_critical_1',
        'bound_cover_critical_2',
        'bound_fill',
        'bound_share',
      ])
      expect(text).toMatch(/^ bound_cover_critical_2: .* <= 1$/m)
      expect(text).toMatch(/^ bound_fill: x_1_20260901 \+ [^\n]* >= 5$/m)
      expect(text.match(/^ nogood_\d+:/gm)).toHaveLength(1)
      expect(text).toMatch(/^ nogood_1: x_1_20260901 \+ x_2_20260903 \+ x_3_20260902 <= 2$/m)
      expect(text).toMatch(/^Minimize\n obj: x_1_20260901 \+ x_2_20260903 \+ x_3_20260902\n/)
    })

    it('counts a duty once per earlier option that holds it', () => {
      const second = new Set(['x_1_20260901', 'x_1_20260903', 'x_3_20260902'])
      const text = alternative([first, second])
      expect(text).toMatch(/^ nogood_2: x_1_20260901 \+ x_1_20260903 \+ x_3_20260902 <= 2$/m)
      expect(text).toMatch(/^ obj: 2 x_1_20260901 \+ x_2_20260903 \+ 2 x_3_20260902 \+ x_1_20260903$/m)
    })

    it('has nothing to optimize without an earlier option', () => {
      expect(buildModel(model, 'alternative', { optima, capacity })).toBeNull()
    })
  })
})

describe('capacityOf', () => {
  // 1-14 November 2026: open days 1, 5, 9, 13 (post-open 2, 6, 10, 14),
  // weekends plus a marked holiday on the 10th, so critical holidays (1, 10,
  // 14) can pass the holiday cap and only then block non-critical ones.
  const days = Array.from({ length: 14 }, (_, i) => {
    const date = `2026-11-${String(i + 1).padStart(2, '0')}`
    const weekend = [0, 6].includes(dayOfWeekISO(date))
    return day(date, weekend, weekend || i === 9)
  })
  const index = indexModel(
    ctx(days, [dr(1), dr(2, 3), dr(3), dr(4, 5)], {
      unavailability: new Map([[3, [{ start: '2026-11-04', end: '2026-11-06' }]]]),
      priorDayDoctorIds: new Set([4]),
      openDuty: { anchorDate: '2026-11-01', intervalDays: 4 },
    }),
  )

  it("equals the largest set of a doctor's days that keeps every per-doctor rule", () => {
    const capacity = capacityOf(index)
    for (const doctor of index.doctors) {
      const cells = index.cellsByDoctor.get(doctor.id) ?? []
      let best = 0
      for (let mask = 0; mask < 1 << cells.length; mask++) {
        const picked = cells.filter((_, i) => mask & (1 << i))
        if (picked.length <= best || picked.length > doctor.maxMonthlyDuties) continue
        const dates = picked.map((p) => p.day.day.date)
        if (dates.some((d) => dates.includes(nextDate(d)))) continue
        if (picked.filter((p) => p.day.open).length > OPEN_DUTY_DUTY_CAP) continue
        const n = picked.filter((p) => p.day.day.isHoliday && !p.day.critical).length
        const critical = picked.filter((p) => p.day.day.isHoliday && p.day.critical).length
        if (n > 0 && n + critical > HOLIDAY_DUTY_CAP) continue
        const weekdays = picked.filter((p) => isFriSatSun(p.day.day)).map((p) => p.day.day.dayOfWeek)
        if (new Set(weekdays).size < weekdays.length) continue
        best = picked.length
      }
      expect(capacity.get(doctor.id), `doctor ${doctor.id}`).toBe(best)
    }
  })
})
