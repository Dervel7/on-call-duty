import { describe, expect, it } from 'vitest'
import { buildModel, indexModel, type Stage } from '../solver-model'
import { ctx, day, dr } from './helpers'

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
