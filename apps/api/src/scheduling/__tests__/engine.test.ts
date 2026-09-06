import { describe, expect, it } from 'vitest'
import { generate } from '../engine'
import { DOCTORS_PER_DAY } from '../constraints'
import { dayOfWeekISO } from '../dates'
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
const day = (d: string, isWeekend = false): DaySpec => ({
  date: d,
  dayOfWeek: dayOfWeekISO(d),
  isWeekend,
})

describe('engine.generate', () => {
  it('assigns two distinct doctors per fillable day', () => {
    const days = [day('2026-09-01'), day('2026-09-03'), day('2026-09-05')]
    const { assignments, conflicts } = generate(ctx(days, [dr(1), dr(2), dr(3)]))
    expect(conflicts).toEqual([])
    for (const date of ['2026-09-01', '2026-09-03', '2026-09-05']) {
      const picked = assignments.filter((a) => a.date === date).map((a) => a.doctorId)
      expect(picked).toHaveLength(DOCTORS_PER_DAY)
      expect(new Set(picked).size).toBe(DOCTORS_PER_DAY) // distinct
    }
    expect(assignments[0]?.reason).toMatch(
      /^score \d+ \(workload \+\d+, weekend \+\d+, friday \+\d+\)/,
    )
  })

  it('a single doctor short-fills a day (1 assigned, conflict emitted)', () => {
    const days = [day('2026-09-01'), day('2026-09-03'), day('2026-09-05')]
    const { assignments, conflicts } = generate(ctx(days, [dr(1)]))
    // one doctor can only hold one slot per day → each day short-fills
    expect(assignments).toHaveLength(3)
    expect(conflicts).toHaveLength(3)
    expect(conflicts[0]?.detail).toContain('only 1 of 2')
  })

  it('enforces no back-to-back across two-doctor days', () => {
    const days = [day('2026-09-01'), day('2026-09-02')]
    const { assignments, conflicts } = generate(ctx(days, [dr(1), dr(2)]))
    // day1: {1,2}; day2: both blocked (back-to-back) → conflict, no assignment
    expect(assignments.filter((a) => a.date === '2026-09-02')).toHaveLength(0)
    expect(conflicts.some((c) => c.date === '2026-09-02' && c.detail.includes('back-to-back'))).toBe(true)
  })

  it('enforces the monthly cap', () => {
    const everyOther = [day('2026-09-01'), day('2026-09-03'), day('2026-09-05'), day('2026-09-07')]
    const { conflicts } = generate(ctx(everyOther, [dr(1, 2), dr(2, 2)]))
    expect(conflicts.length).toBeGreaterThan(0)
    expect(conflicts.some((c) => c.detail.includes('at monthly cap'))).toBe(true)
  })

  it('respects unavailability: a fully-unavailable day becomes a conflict', () => {
    const days = [day('2026-09-01')]
    const un = new Map([
      [1, [{ start: '2026-09-01', end: '2026-09-01' }]],
      [2, [{ start: '2026-09-01', end: '2026-09-01' }]],
    ])
    const { assignments, conflicts } = generate(ctx(days, [dr(1), dr(2)], { unavailability: un }))
    expect(assignments).toEqual([])
    expect(conflicts[0]?.detail).toContain('unavailable')
  })

  it('respects cross-month prior-day duty via priorDayDoctorIds', () => {
    const days = [day('2026-09-01'), day('2026-09-02')]
    const prior = new Set([1, 2])
    const { assignments } = generate(ctx(days, [dr(1), dr(2), dr(3), dr(4)], { priorDayDoctorIds: prior }))
    const day1 = assignments.filter((a) => a.date === '2026-09-01').map((a) => a.doctorId)
    expect(day1).not.toContain(1)
    expect(day1).not.toContain(2)
  })

  it('spreads Saturday duties within the ±1 balance cap', () => {
    // four Saturdays, enough distinct doctors that the balance cap binds at 1
    const sats = ['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26'].map((d) => day(d, true))
    const doctors = Array.from({ length: 10 }, (_, i) => dr(i + 1))
    const { assignments, conflicts } = generate(ctx(sats, doctors))
    const satCount = new Map<number, number>()
    for (const a of assignments) satCount.set(a.doctorId, (satCount.get(a.doctorId) ?? 0) + 1)
    for (const c of satCount.values()) expect(c).toBeLessThanOrEqual(1)
    expect(conflicts).toEqual([])
  })

  it('fills five Saturdays with eight doctors (cap 2, still ±1 balanced)', () => {
    // 5 Saturdays * 2 slots = 10 slots over 8 doctors: a fixed <=1 cap would
    // make the month ungeneratable; the balance cap allows at most 2 each.
    const sats = ['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31'].map((d) =>
      day(d, true),
    )
    const doctors = Array.from({ length: 8 }, (_, i) => dr(i + 1))
    const { assignments, conflicts } = generate(ctx(sats, doctors))
    const satCount = new Map<number, number>()
    for (const a of assignments) satCount.set(a.doctorId, (satCount.get(a.doctorId) ?? 0) + 1)
    for (const c of satCount.values()) expect(c).toBeLessThanOrEqual(2)
    expect(conflicts).toEqual([])
    expect(assignments).toHaveLength(10)
  })

  it('is deterministic: same context yields identical output twice', () => {
    const days = Array.from({ length: 10 }, (_, i) => day(`2026-09-${String(i + 1).padStart(2, '0')}`))
    const a = generate(ctx(days, [dr(1), dr(2), dr(3), dr(4)]))
    const b = generate(ctx(days, [dr(1), dr(2), dr(3), dr(4)]))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
