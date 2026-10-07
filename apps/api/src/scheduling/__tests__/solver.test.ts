import type { LegacyHighsSolution } from 'highs'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  HOLIDAY_DUTY_CAP,
  isAvailable,
  notConsecutive,
  underCap,
  underOpenDutyCap,
} from '../constraints'
import { dayOfWeekISO, isOpenDutyDate, minimumForDate, prevDate, slotsForDate } from '../dates'
import { generateGreedy } from '../engine'
import { loadSolver, type SolverLoader } from '../highs'
import { generate, generateOptions } from '../solver'
import type { GenerateResult, SchedulingContext } from '../types'
import { october2026 } from './fixtures/october-2026'
import { ctx, day, dr } from './helpers'

const SLOW = 60_000

/** Per-doctor counts of an engine result. */
function profile(c: SchedulingContext, result: GenerateResult) {
  const isHoliday = new Map(c.days.map((d) => [d.date, d.isHoliday]))
  return c.doctors.map((doctor) => {
    const dates = result.assignments.filter((a) => a.doctorId === doctor.id).map((a) => a.date)
    const weekday = (n: number): number => dates.filter((d) => dayOfWeekISO(d) === n).length
    return {
      id: doctor.id,
      total: dates.length,
      fri: weekday(5),
      sat: weekday(6),
      sun: weekday(0),
      holiday: dates.filter((d) => isHoliday.get(d)).length,
    }
  })
}

/** Asserts every hard rule with the production rule helpers, duty by duty. */
function expectHardRules(c: SchedulingContext, result: GenerateResult): void {
  const byDate = new Map<string, number[]>()
  for (const a of result.assignments) byDate.set(a.date, [...(byDate.get(a.date) ?? []), a.doctorId])
  for (const [date, ids] of byDate) {
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeLessThanOrEqual(slotsForDate(date, c.openDuty, c.slots))
  }
  for (const doctor of c.doctors) {
    const dates = result.assignments.filter((a) => a.doctorId === doctor.id).map((a) => a.date).sort()
    let openDays = 0
    dates.forEach((date, i) => {
      expect(isAvailable(doctor.id, date, c.unavailability.get(doctor.id)).ok).toBe(true)
      expect(underCap(i, doctor.maxMonthlyDuties).ok).toBe(true)
      const yesterday =
        date === c.days[0]?.date ? c.priorDayDoctorIds.has(doctor.id) : dates.includes(prevDate(date))
      expect(notConsecutive(yesterday).ok).toBe(true)
      if (isOpenDutyDate(date, c.openDuty.anchorDate, c.openDuty.intervalDays)) {
        expect(underOpenDutyCap(openDays).ok).toBe(true)
        openDays++
      }
    })
  }
}

/**
 * Wraps the real solver and reports a time limit from the `fromCall`-th solve
 * on (1-based), with or without the incumbent HiGHS found.
 */
function timeLimitedLoader(fromCall: number, incumbent: boolean): SolverLoader {
  return async () => {
    const real = await loadSolver()
    let call = 0
    return {
      async solve(lp, options, deadline) {
        const result = await real.solve(lp, options, deadline)
        call++
        if (!result || result.Status === 'Infeasible' || call < fromCall) return result
        return {
          ...result,
          Status: 'Time limit reached',
          ObjectiveValue: incumbent ? result.ObjectiveValue : Infinity,
        }
      },
    }
  }
}

describe('solver: October 2026, Main Clinic (design acceptance)', () => {
  const c = october2026()
  let first: GenerateResult
  let second: GenerateResult
  beforeAll(async () => {
    first = await generate(c)
    second = await generate(october2026())
  }, SLOW)

  it('covers every day: 59 duties, no conflicts', () => {
    expect(first.conflicts).toEqual([])
    expect(first.assignments).toHaveLength(59)
    for (const d of c.days) {
      expect(first.assignments.filter((a) => a.date === d.date).length).toBeGreaterThanOrEqual(
        minimumForDate(d.date, c.openDuty, c.minimums),
      )
    }
  })

  it('gives every doctor one Friday and one Saturday, and 8 of 9 one Sunday', () => {
    const rows = profile(c, first)
    expect(rows.every((r) => r.fri === 1 && r.sat === 1)).toBe(true)
    // Only 4 Sundays x 2 slots exist.
    expect(rows.filter((r) => r.sun === 1)).toHaveLength(8)
    expect(rows.filter((r) => r.sun === 0)).toHaveLength(1)
  })

  it('balances totals within one duty and keeps the holiday cap', () => {
    const rows = profile(c, first)
    const totals = rows.map((r) => r.total)
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(1)
    expect(rows.every((r) => r.holiday <= HOLIDAY_DUTY_CAP)).toBe(true)
  })

  it('keeps every hard rule on every duty', () => {
    expectHardRules(c, first)
  })

  it('explains every duty with the solver status and its Fri/Sat/Sun note', () => {
    expect(first.assignments.every((a) => a.reason.startsWith('solver optimal'))).toBe(true)
    for (const a of first.assignments) {
      const note = { 5: 'first friday', 6: 'first saturday', 0: 'first sunday' }[dayOfWeekISO(a.date)]
      if (note) expect(a.reason).toBe(`solver optimal; ${note}`)
      else expect(a.reason).toBe('solver optimal')
    }
  })

  it('is deterministic: the same input gives the same schedule', () => {
    expect(second).toEqual(first)
  })
})

describe('solver: fairness rules', () => {
  it('D2: leaves an extra slot empty rather than repeat a Saturday', async () => {
    const sats = [day('2026-09-05', true), day('2026-09-12', true)]
    const minimums = { openDutyMinimum: 2, postOpenDutyMinimum: 2, closedDutyMinimum: 1 }
    const { assignments, conflicts } = await generate(ctx(sats, [dr(1), dr(2)], { minimums }))
    expect(conflicts).toEqual([])
    expect(assignments).toHaveLength(2)
    expect(new Set(assignments.map((a) => a.doctorId)).size).toBe(2)
  })

  it('D2: repeats a Saturday when the day cannot reach its minimum otherwise', async () => {
    const sats = [day('2026-09-05', true), day('2026-09-12', true)]
    const minimums = { openDutyMinimum: 2, postOpenDutyMinimum: 2, closedDutyMinimum: 1 }
    const { assignments, conflicts } = await generate(ctx(sats, [dr(1)], { minimums }))
    expect(conflicts).toEqual([])
    expect(assignments.map((a) => a.date)).toEqual(['2026-09-05', '2026-09-12'])
    expect(assignments[0]?.reason).toBe('solver optimal')
    expect(assignments[1]?.reason).toBe('solver optimal; repeat weekday to reach minimum')
  })

  it('holiday cap: only the regular holiday over the cap is an override', async () => {
    // Marked holidays Tue 1, Thu 3 and Tue 8; the 8th is an open on-call day
    // (critical, exempt from the cap but counted). One doctor must cover all
    // three, so one regular holiday goes over the cap: the later one.
    const days = [
      day('2026-09-01', false, true),
      day('2026-09-03', false, true),
      day('2026-09-08', false, true),
    ]
    const { assignments } = await generate(
      ctx(days, [dr(1)], {
        openDuty: { anchorDate: '2026-09-08', intervalDays: 30 },
        minimums: { openDutyMinimum: 1, postOpenDutyMinimum: 1, closedDutyMinimum: 1 },
      }),
    )
    expect(assignments.map((a) => [a.date, a.reason])).toEqual([
      ['2026-09-01', 'solver optimal'],
      ['2026-09-03', 'solver optimal; day-fill guarantee overrode fairness caps'],
      ['2026-09-08', 'solver optimal'],
    ])
  })

  it('mixed monthly caps: a lower cap lowers that doctor\'s share, not everyone\'s', async () => {
    // An absolute spread would cap the others near the capped doctor's 3.
    const c = october2026()
    c.doctors[8]!.maxMonthlyDuties = 3
    const result = await generate(c)
    const rows = profile(c, result)
    const others = rows.filter((r) => r.id !== 9).map((r) => r.total)
    expect(result.conflicts).toEqual([])
    expect(rows.find((r) => r.id === 9)?.total).toBe(3)
    expect(Math.min(...others)).toBeGreaterThanOrEqual(6)
    expect(Math.max(...others) - Math.min(...others)).toBeLessThanOrEqual(1)
    expectHardRules(c, result)
  }, SLOW)

  it('long leave: an absent doctor does not lower everyone else\'s duties', async () => {
    const c = october2026()
    c.unavailability.set(9, [{ start: '2026-10-01', end: '2026-10-27' }])
    const result = await generate(c)
    const others = profile(c, result).filter((r) => r.id !== 9).map((r) => r.total)
    expect(result.conflicts).toEqual([])
    expect(Math.min(...others)).toBeGreaterThanOrEqual(6)
    expectHardRules(c, result)
  }, SLOW)
})

describe('solver: budget and fallback', () => {
  const days = [day('2026-09-01'), day('2026-09-03'), day('2026-09-05')]
  const c = ctx(days, [dr(1), dr(2), dr(3)])

  it('falls back to the greedy engine when the solver cannot load', async () => {
    const result = await generate(c, () => Promise.reject(new Error('wasm load failed')))
    const greedy = generateGreedy(c)
    expect(result.conflicts).toEqual(greedy.conflicts)
    expect(result.assignments).toEqual(
      greedy.assignments.map((a) => ({ ...a, reason: `${a.reason}; fallback` })),
    )
  })

  it('falls back to the greedy engine when a solve fails', async () => {
    const failing: SolverLoader = async () => ({ solve: () => Promise.reject(new Error('worker crashed')) })
    const result = await generate(c, failing)
    expect(result.assignments.length).toBeGreaterThan(0)
    expect(result.assignments.every((a) => a.reason.endsWith('; fallback'))).toBe(true)
  })

  it('uses the best solution at the time limit and says so', async () => {
    // Solve 1 is the capacity stage, solve 2 the first coverage stage.
    const result = await generate(c, timeLimitedLoader(2, true))
    expect(result.assignments.length).toBeGreaterThanOrEqual(3)
    expect(result.assignments.every((a) => a.reason.startsWith('solver time limit'))).toBe(true)
    expectHardRules(c, result)
  })

  it("keeps the previous stage's solution when a later stage finds none in time", async () => {
    const result = await generate(c, timeLimitedLoader(3, false))
    expect(result.assignments.length).toBeGreaterThanOrEqual(3)
    expect(result.assignments.every((a) => a.reason.startsWith('solver time limit'))).toBe(true)
  })

  it('falls back when no schedule is found in time', async () => {
    const result = await generate(c, timeLimitedLoader(2, false))
    expect(result.assignments.every((a) => a.reason.endsWith('; fallback'))).toBe(true)
  })
})

/** Wraps the real solver; `override` replaces the result of every alternative solve. */
function alternativeLoader(
  override: (result: LegacyHighsSolution | null) => Promise<LegacyHighsSolution | null>,
): SolverLoader {
  return async () => {
    const real = await loadSolver()
    return {
      async solve(lp, options, deadline) {
        const result = await real.solve(lp, options, deadline)
        return lp.includes(' nogood_') ? override(result) : result
      },
    }
  }
}

/** One key per duty, to compare the duty sets of two options. */
const dutyKeys = (result: GenerateResult): string[] => result.assignments.map((a) => `${a.date}/${a.doctorId}`)

describe('solver: options', () => {
  describe('October 2026, Main Clinic', () => {
    const c = october2026()
    let options: GenerateResult[]
    let again: GenerateResult[]
    let primary: GenerateResult
    beforeAll(async () => {
      options = await generateOptions(c, 3)
      again = await generateOptions(october2026(), 3)
      primary = await generate(october2026())
    }, 3 * SLOW)

    it('returns 3 options, the first one equal to generate()', () => {
      expect(options).toHaveLength(3)
      expect(options[0]).toEqual(primary)
    })

    it('keeps every option equally good: hard rules, coverage, Fri/Sat/Sun, totals, holiday cap', () => {
      const weekdays = (r: GenerateResult): string[] =>
        profile(c, r).map((p) => `${p.fri}/${p.sat}/${p.sun}`).sort()
      for (const option of options) {
        expectHardRules(c, option)
        expect(option.conflicts).toEqual([])
        expect(option.assignments).toHaveLength(59)
        expect(weekdays(option)).toEqual(weekdays(options[0]!))
        const rows = profile(c, option)
        const totals = rows.map((r) => r.total)
        expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(1)
        expect(rows.every((r) => r.holiday <= HOLIDAY_DUTY_CAP)).toBe(true)
        expect(option.assignments.every((a) => a.reason.startsWith('solver optimal'))).toBe(true)
      }
    })

    it('gives pairwise different options', () => {
      const keys = options.map((o) => dutyKeys(o).sort().join(','))
      expect(new Set(keys).size).toBe(3)
    })

    it('is deterministic: the same input gives the same options', () => {
      expect(again).toEqual(options)
    })
  })

  it('returns 1 option when the optimum is unique', async () => {
    // One doctor must take both Saturdays: no other schedule fills them.
    const sats = [day('2026-09-05', true), day('2026-09-12', true)]
    const minimums = { openDutyMinimum: 1, postOpenDutyMinimum: 1, closedDutyMinimum: 1 }
    const options = await generateOptions(ctx(sats, [dr(1)], { minimums }), 3)
    expect(options).toHaveLength(1)
    expect(options[0]?.assignments).toHaveLength(2)
  })

  describe('budget and failures', () => {
    const days = [day('2026-09-01'), day('2026-09-03'), day('2026-09-05')]
    const c = ctx(days, [dr(1), dr(2), dr(3)])

    it('has several options when nothing fails', async () => {
      expect((await generateOptions(c, 3)).length).toBeGreaterThan(1)
    })

    it('returns only the primary option when it stopped at the time limit', async () => {
      const options = await generateOptions(c, 3, timeLimitedLoader(2, true))
      expect(options).toHaveLength(1)
      expect(options[0]?.assignments.every((a) => a.reason.startsWith('solver time limit'))).toBe(true)
    })

    it('returns only the fallback option when the solver cannot load', async () => {
      const options = await generateOptions(c, 3, () => Promise.reject(new Error('wasm load failed')))
      expect(options).toHaveLength(1)
      expect(options[0]?.assignments.every((a) => a.reason.endsWith('; fallback'))).toBe(true)
    })

    it('keeps the primary option when an alternative finds none in time', async () => {
      const timeLimit = alternativeLoader(async (result) =>
        result?.Status === 'Optimal' ? { ...result, Status: 'Time limit reached', ObjectiveValue: Infinity } : result,
      )
      const options = await generateOptions(c, 3, timeLimit)
      expect(options).toHaveLength(1)
      expect(options[0]).toEqual(await generate(c))
    })

    it('keeps the primary option when an alternative solve fails', async () => {
      const options = await generateOptions(c, 3, alternativeLoader(() => Promise.reject(new Error('worker crashed'))))
      expect(options).toHaveLength(1)
      expect(options[0]).toEqual(await generate(c))
    })
  })
})
