import { describe, expect, it } from 'vitest'
import { generateGreedy } from '../engine'
import { ctx, day, dr } from './helpers'

// Greedy internals: score breakdown in the reason and the fixed pass order.
// Outcome rules shared with the solver are in engine.test.ts.
describe('generateGreedy', () => {
  it('writes the score breakdown into every reason', () => {
    const days = [day('2026-09-01'), day('2026-09-03'), day('2026-09-05')]
    const { assignments } = generateGreedy(ctx(days, [dr(1), dr(2), dr(3)]))
    for (const a of assignments) {
      expect(a.reason).toMatch(
        /^score \d+ \(workload \+\d+, weekend \+\d+, friday \+\d+, first fri\/sat\/sun \+\d+\)(; tie-break: (fewer duties|fewer weekend duties|lower id))?$/,
      )
    }
  })

  it('breaks equal scores by the lowest id and says so', () => {
    const { assignments } = generateGreedy(ctx([day('2026-09-01')], [dr(1), dr(2), dr(3)]))
    expect(assignments.map((a) => a.doctorId)).toEqual([1, 2])
    expect(assignments[0]?.reason).toContain('; tie-break: lower id')
  })

  it('fills critical days pass by pass: lowest ids first, alternating days', () => {
    const days = [day('2026-09-01'), day('2026-09-02'), day('2026-09-03')]
    const { assignments } = generateGreedy(
      ctx(days, [dr(1, 1), dr(2, 1), dr(3, 1), dr(4, 1)], {
        openDuty: { anchorDate: '2026-09-01', intervalDays: 30 },
      }),
    )
    // First slot of each critical day, then the second slot of each.
    expect(assignments.filter((a) => a.date === '2026-09-01').map((a) => a.doctorId).sort()).toEqual([1, 3])
    expect(assignments.filter((a) => a.date === '2026-09-02').map((a) => a.doctorId).sort()).toEqual([2, 4])
  })
})
