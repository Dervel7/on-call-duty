import { describe, expect, it } from 'vitest'
import { generate } from '../engine'
import type { DaySpec, DoctorSpec, SchedulingContext } from '../types'

function ctx(
  days: DaySpec[],
  doctors: DoctorSpec[],
  opts: {
    unavailability?: Map<number, Array<{ start: string; end: string }>>
    priorDayDoctorIds?: Set<number>
  } = {},
): SchedulingContext {
  return {
    year: 2026,
    month: 9,
    days,
    doctors,
    unavailability: opts.unavailability ?? new Map(),
    priorDayDoctorIds: opts.priorDayDoctorIds ?? new Set(),
  }
}

const dr = (id: number, max = 7): DoctorSpec => ({
  id,
  firstName: `F${id}`,
  lastName: `L${id}`,
  maxMonthlyDuties: max,
  isActive: true,
})
const day = (d: string, isWeekend = false, isHoliday = false): DaySpec => ({
  date: d,
  isWeekend,
  isHoliday,
})

describe('engine.generate', () => {
  it('assigns the lone eligible doctor each day and records a persisted reason', () => {
    const days = [day('2026-09-01'), day('2026-09-03'), day('2026-09-05')]
    const { assignments, conflicts } = generate(ctx(days, [dr(1)]))
    expect(conflicts).toEqual([])
    expect(assignments).toHaveLength(3)
    expect(assignments.every((a) => a.doctorId === 1)).toBe(true)
    expect(assignments[0]?.reason).toMatch(/^score \d+ \(workload \+\d+, weekend \+\d+, holiday \+\d+\)/)
  })

  it('enforces no back-to-back: a single doctor cannot take consecutive days', () => {
    const days = [day('2026-09-01'), day('2026-09-02')]
    const { conflicts } = generate(ctx(days, [dr(1)]))
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.date).toBe('2026-09-02')
    expect(conflicts[0]?.detail).toContain('back-to-back')
  })

  it('respects unavailability: an unavailable-only day becomes a conflict', () => {
    const days = [day('2026-09-01')]
    const un = new Map([[1, [{ start: '2026-09-01', end: '2026-09-01' }]]])
    const { conflicts, assignments } = generate(ctx(days, [dr(1)], { unavailability: un }))
    expect(assignments).toEqual([])
    expect(conflicts[0]?.detail).toContain('unavailable')
  })

  it('enforces the monthly cap', () => {
    const everyOther = [day('2026-09-01'), day('2026-09-03'), day('2026-09-05'), day('2026-09-07')]
    const { conflicts } = generate(ctx(everyOther, [dr(1, 2)]))
    expect(conflicts.length).toBeGreaterThan(0)
    expect(conflicts.some((c) => c.detail.includes('at cap'))).toBe(true)
  })

  it('respects cross-month prior-day duty via priorDayDoctorIds (day 1 blocked)', () => {
    const days = [day('2026-09-01'), day('2026-09-02')]
    const prior = new Set([1])
    const { assignments } = generate(ctx(days, [dr(1), dr(2)], { priorDayDoctorIds: prior }))
    expect(assignments[0]?.doctorId).not.toBe(1)
  })

  it('balances workload: two equal doctors alternate (deterministic tie-break)', () => {
    const days = [
      day('2026-09-01'),
      day('2026-09-02'),
      day('2026-09-03'),
      day('2026-09-04'),
    ]
    const { assignments } = generate(ctx(days, [dr(1), dr(2)]))
    const ids = assignments.map((a) => a.doctorId)
    expect(ids).toEqual([1, 2, 1, 2])
  })

  it('is deterministic: same context yields identical output twice', () => {
    const days = Array.from({ length: 10 }, (_, i) =>
      day(`2026-09-${String(i + 1).padStart(2, '0')}`),
    )
    const a = generate(ctx(days, [dr(1), dr(2), dr(3)]))
    const b = generate(ctx(days, [dr(1), dr(2), dr(3)]))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
