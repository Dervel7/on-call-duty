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
    openDuty?: { anchorDate: string; intervalDays: number }
  } = {},
): SchedulingContext {
  return {
    year: 2026,
    month: 9,
    days,
    doctors,
    unavailability: opts.unavailability ?? new Map(),
    priorDayDoctorIds: opts.priorDayDoctorIds ?? new Set(),
    // Default cycle starts after every test month, so no day is critical.
    openDuty: opts.openDuty ?? { anchorDate: '2030-01-01', intervalDays: 7 },
  }
}

const dr = (id: number, max = 7): DoctorSpec => ({
  id,
  firstName: `F${id}`,
  lastName: `L${id}`,
  maxMonthlyDuties: max,
  isActive: true,
})
const day = (d: string, isWeekend = false, isHoliday = isWeekend): DaySpec => ({
  date: d,
  dayOfWeek: dayOfWeekISO(d),
  isWeekend,
  isHoliday,
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

  it('enforces no back-to-back with two doctors over two consecutive days', () => {
    const days = [day('2026-09-01'), day('2026-09-02')]
    const { assignments, conflicts } = generate(ctx(days, [dr(1), dr(2)]))
    // Coverage first gives each day one doctor; neither doctor may hold both
    // days, and the second slots are unfillable (back-to-back).
    const day1 = assignments.filter((a) => a.date === '2026-09-01').map((a) => a.doctorId)
    const day2 = assignments.filter((a) => a.date === '2026-09-02').map((a) => a.doctorId)
    expect(day1).toHaveLength(1)
    expect(day2).toHaveLength(1)
    expect(day1).not.toEqual(day2)
    expect(conflicts).toHaveLength(2)
    expect(conflicts.every((c) => c.detail.includes('back-to-back'))).toBe(true)
  })

  it('covers every day with one doctor before assigning second doctors', () => {
    // Two doctors capped at 2 duties: doubling up day 1 (the old strategy)
    // starved days 3 and 4 to zero doctors; coverage-first fills all days.
    const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'].map((d) => day(d))
    const { assignments, conflicts } = generate(ctx(days, [dr(1, 2), dr(2, 2)]))
    for (const { date } of days) {
      expect(assignments.filter((a) => a.date === date)).toHaveLength(1)
    }
    expect(conflicts).toHaveLength(4)
    expect(conflicts.every((c) => c.detail.includes('only 1 of 2'))).toBe(true)
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

  it('holiday cap yields to the day-fill guarantee: a sole doctor still covers the day', () => {
    // Marked weekdays (Tue/Thu, non-adjacent): the doctor is at the holiday
    // cap (2/2) on the third day, but the strict ≥1-doctor-per-day rule
    // overrides the fairness cap instead of leaving the day empty. Only the
    // first slot relaxes: the top-up pass still short-fills.
    const days = [
      day('2026-09-01', false, true),
      day('2026-09-03', false, true),
      day('2026-09-08', false, true),
    ]
    const { assignments, conflicts } = generate(ctx(days, [dr(1)]))
    expect(assignments).toHaveLength(3)
    expect(assignments.every((a) => a.doctorId === 1)).toBe(true)
    expect(assignments.find((a) => a.date === '2026-09-08')?.reason).toContain(
      'day-fill guarantee overrode fairness caps',
    )
    expect(conflicts.every((c) => c.detail.includes('only 1 of 2'))).toBe(true)
  })

  it('weekend holiday cap yields to the day-fill guarantee too', () => {
    const sats = ['2026-09-05', '2026-09-12', '2026-09-19'].map((d) => day(d, true))
    const { assignments, conflicts } = generate(ctx(sats, [dr(1)]))
    expect(assignments).toHaveLength(3)
    expect(assignments.find((a) => a.date === '2026-09-19')?.reason).toContain(
      'day-fill guarantee overrode fairness caps',
    )
    expect(conflicts.every((c) => c.detail.includes('only 1 of 2'))).toBe(true)
  })

  it('day-fill guarantee: a Sunday nobody can take under fairness caps still gets a doctor', () => {
    // Four Sundays, nine doctors → Sunday balance cap 1. Doctors 1-3 spend
    // their Sunday duty on the first three Sundays; everyone else is
    // excluded on the last one. The strict ≥1-doctor-per-day rule overrides
    // the balance cap instead of leaving the day empty — and only for the
    // first slot: the top-up pass never relaxes.
    const sundays = ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27'].map((d) =>
      day(d, true),
    )
    const doctors = Array.from({ length: 9 }, (_, i) => dr(i + 1))
    const un = new Map<number, Array<{ start: string; end: string }>>()
    for (let id = 4; id <= 9; id++) un.set(id, [{ start: '2026-09-27', end: '2026-09-27' }])
    const { assignments, conflicts } = generate(ctx(sundays, doctors, { unavailability: un }))
    const last = assignments.filter((a) => a.date === '2026-09-27')
    expect(last).toHaveLength(1)
    expect(last[0]?.reason).toContain('day-fill guarantee overrode fairness caps')
    expect(conflicts.map((c) => c.date)).toEqual(['2026-09-27'])
    expect(conflicts[0]?.detail).toContain('only 1 of 2')
  })

  it('day-fill guarantee never breaks hard constraints: back-to-back still empties the day', () => {
    // Consecutive marked holidays: the sole doctor takes the first; the
    // second is back-to-back, and relaxing fairness caps cannot fix that.
    const days = [day('2026-09-01', false, true), day('2026-09-02', false, true)]
    const { assignments, conflicts } = generate(ctx(days, [dr(1)]))
    expect(assignments.map((a) => a.date)).toEqual(['2026-09-01'])
    expect(conflicts.map((c) => c.date)).toEqual(['2026-09-02', '2026-09-01'])
    expect(conflicts.find((c) => c.date === '2026-09-02')?.detail).toContain('back-to-back')
  })

  it('non-holiday weekdays are unaffected: a doctor may exceed 2 duties there', () => {
    const days = ['2026-09-01', '2026-09-03', '2026-09-08', '2026-09-10'].map((d) => day(d))
    const { assignments } = generate(ctx(days, [dr(1)]))
    expect(assignments).toHaveLength(4)
    expect(assignments.every((a) => a.doctorId === 1)).toBe(true)
  })
  it('open on-call rule: open days and the day after are doubled before regular days get anyone', () => {
    const days = [day('2026-09-01'), day('2026-09-02'), day('2026-09-03')]
    // Anchor 09-01 with a long interval: 09-01 is open, 09-02 is the day
    // after an open day — both critical. Four doctors with one duty each.
    const { assignments, conflicts } = generate(
      ctx(days, [dr(1, 1), dr(2, 1), dr(3, 1), dr(4, 1)], {
        openDuty: { anchorDate: '2026-09-01', intervalDays: 30 },
      }),
    )
    expect(assignments.filter((a) => a.date === '2026-09-01').map((a) => a.doctorId).sort()).toEqual([1, 3])
    expect(assignments.filter((a) => a.date === '2026-09-02').map((a) => a.doctorId).sort()).toEqual([2, 4])
    // The regular day starves instead: every doctor spent their single duty
    // on the critical pair first.
    expect(conflicts.map((c) => c.date)).toEqual(['2026-09-03'])
  })

  it('open on-call rule: day 1 is critical when the previous month ends on an open day', () => {
    const days = [day('2026-09-01'), day('2026-09-02')]
    // Anchor 2026-08-31: Aug 31 is open, so Sept 1 (the day after) must be
    // doubled even though no September day is open.
    const { assignments, conflicts } = generate(
      ctx(days, [dr(1), dr(2), dr(3)], {
        openDuty: { anchorDate: '2026-08-31', intervalDays: 90 },
        priorDayDoctorIds: new Set([1]),
      }),
    )
    // Doctor 1 held the previous month's last day, so back-to-back still
    // excludes them from the critical day 1 — hard rules never bend.
    expect(assignments.filter((a) => a.date === '2026-09-01').map((a) => a.doctorId).sort()).toEqual([2, 3])
    expect(conflicts.map((c) => c.date)).toEqual(['2026-09-02'])
  })

  it('open on-call rule: the weekend balance cap never blocks a critical day', () => {
    // Anchor 09-05, interval 7: every Saturday is open and every Sunday is
    // the day after an open day — all critical. Doctor 1 is available only
    // on Sundays (blocked from the open Saturdays), so they take three
    // Sunday duties — over the ±1 balance cap of 1 — because the strict rule
    // outranks fairness. The open Saturdays themselves spread at most one
    // duty per doctor: the open on-call cap is a hard rule.
    const days = [
      '2026-09-05', '2026-09-06', '2026-09-12', '2026-09-13',
      '2026-09-19', '2026-09-20', '2026-09-26', '2026-09-27',
    ].map((d) => day(d, true))
    const doctors = Array.from({ length: 13 }, (_, i) => dr(i + 1))
    const un = new Map<number, Array<{ start: string; end: string }>>()
    un.set(1, [
      { start: '2026-09-05', end: '2026-09-05' },
      { start: '2026-09-12', end: '2026-09-12' },
      { start: '2026-09-19', end: '2026-09-19' },
      { start: '2026-09-26', end: '2026-09-26' },
    ])
    for (let id = 2; id <= 13; id++)
      un.set(id, [
        { start: '2026-09-06', end: '2026-09-06' },
        { start: '2026-09-20', end: '2026-09-20' },
        { start: '2026-09-27', end: '2026-09-27' },
      ])
    const { assignments, conflicts } = generate(
      ctx(days, doctors, {
        unavailability: un,
        openDuty: { anchorDate: '2026-09-05', intervalDays: 7 },
      }),
    )
    expect(assignments.filter((a) => a.doctorId === 1).map((a) => a.date)).toEqual([
      '2026-09-06',
      '2026-09-20',
      '2026-09-27',
    ])
    // Hard rule: nobody holds two duties on open on-call days.
    const openSats = ['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26']
    const perDoctor = new Map<number, number>()
    for (const a of assignments.filter((a) => openSats.includes(a.date)))
      perDoctor.set(a.doctorId, (perDoctor.get(a.doctorId) ?? 0) + 1)
    expect([...perDoctor.values()].every((n) => n <= 1)).toBe(true)
    // Sundays where only doctor 1 is available short-fill the second slot.
    expect(conflicts.map((c) => c.date).sort()).toEqual(['2026-09-06', '2026-09-20', '2026-09-27'])
  })


  it('open on-call rule: an unfillable open day carries the strict-rule prefix', () => {
    const un = new Map([[1, [{ start: '2026-09-01', end: '2026-09-01' }]]])
    const { assignments, conflicts } = generate(
      ctx([day('2026-09-01')], [dr(1)], {
        unavailability: un,
        openDuty: { anchorDate: '2026-09-01', intervalDays: 30 },
      }),
    )
    expect(assignments).toEqual([])
    expect(conflicts[0]?.detail).toContain('requires 2 doctors (open on-call rule)')
    expect(conflicts[0]?.detail).toContain('unavailable')
  })

  it('open on-call rule: a doctor never takes a second open on-call day', () => {
    // Anchor 09-05, interval 7: all four Saturdays are open (8 slots). Eight
    // doctors cover them exactly once each — the cap never bends.
    const sats = ['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26'].map((d) => day(d, true))
    const doctors = Array.from({ length: 8 }, (_, i) => dr(i + 1))
    const { assignments, conflicts } = generate(
      ctx(sats, doctors, { openDuty: { anchorDate: '2026-09-05', intervalDays: 7 } }),
    )
    expect(conflicts).toEqual([])
    expect(assignments).toHaveLength(8)
    const perDoctor = new Map<number, number>()
    for (const a of assignments) perDoctor.set(a.doctorId, (perDoctor.get(a.doctorId) ?? 0) + 1)
    expect([...perDoctor.values()].every((n) => n === 1)).toBe(true)
  })

  it('open on-call rule: a second open-day duty is a hard conflict, even for double coverage', () => {
    // Anchor 09-01, interval 8: 09-01 and 09-09 are both open and need 4
    // slots, but the two doctors may each hold one open day only, so both
    // days short-fill and the conflict names the open on-call cap.
    const days = [day('2026-09-01'), day('2026-09-09')]
    const { assignments, conflicts } = generate(
      ctx(days, [dr(1), dr(2)], { openDuty: { anchorDate: '2026-09-01', intervalDays: 8 } }),
    )
    expect(assignments.map((a) => a.doctorId).sort()).toEqual([1, 2])
    expect(conflicts.map((c) => c.date)).toEqual(['2026-09-01', '2026-09-09'])
    expect(conflicts.every((c) => c.detail.includes('at open on-call cap'))).toBe(true)
  })
})
