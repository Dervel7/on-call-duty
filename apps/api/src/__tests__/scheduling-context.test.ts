import { describe, expect, it, vi } from 'vitest'

vi.mock('../db/client.ts', () => ({ query: vi.fn(), withTransaction: vi.fn() }))

import { computeEligibility } from '../services/scheduling-context.ts'
import type { DoctorSpec } from '../scheduling/types.ts'

describe('computeEligibility', () => {
  const day = (date: string, isWeekend = false, isHoliday = isWeekend) => ({
    date,
    dayOfWeek: new Date(`${date}T00:00:00Z`).getUTCDay(),
    isWeekend,
    isHoliday,
  })
  const empty = () => ({
    openDuty: { anchorDate: '2026-10-02', intervalDays: 8 },
    slots: { openDutySlots: 2, postOpenDutySlots: 2, closedDutySlots: 2 },
    minimums: { openDutyMinimum: 2, postOpenDutyMinimum: 2, closedDutyMinimum: 2 },
    dutiesByDate: new Map<string, Set<number>>(),
    dutyCountByDoctor: new Map<number, number>(),
    regularHolidayByDoctor: new Map<number, number>(),
    criticalHolidayByDoctor: new Map<number, number>(),
    openByDoctor: new Map<number, number>(),
  })

  const doctor = (id: number, maxMonthlyDuties = 7): DoctorSpec => ({
    id,
    firstName: `D${id}`,
    lastName: `D${id}`,
    maxMonthlyDuties,
  })

  it('eligible: active, available, under cap, not on adjacent duty -> included', () => {
    const result = computeEligibility({
      doctors: [doctor(1)],
      unavailability: new Map(),
      days: [day('2026-09-10')],
      ...empty(),
    })
    expect(result).toEqual([
      {
        date: '2026-09-10',
        isWeekend: false,
        dutyType: 'closed',
        slotsRequired: 2,
        slotsMinimum: 2,
        eligibleDoctorIds: [1],
        availableDoctorIds: [1],
      },
    ])
  })

  it('dutyType: the anchor and whole intervals after it are open, all else closed', () => {
    const result = computeEligibility({
      doctors: [doctor(1)],
      unavailability: new Map(),
      days: [
        day('2026-10-01'),
        day('2026-10-02'),
        day('2026-10-09'),
        day('2026-10-10'),
        day('2026-11-11'),
      ],
      ...empty(),
    })
    expect(result.map((d) => [d.date, d.dutyType])).toEqual([
      ['2026-10-01', 'closed'], // before the anchor: never open
      ['2026-10-02', 'open'], // the anchor itself
      ['2026-10-09', 'closed'], // 7 days after the anchor
      ['2026-10-10', 'open'], // one interval after the anchor
      ['2026-11-11', 'open'], // 40 days = 5 intervals, wraps the month
    ])
  })

  it('slotsRequired/slotsMinimum: open, post-open, and closed days report their own counts', () => {
    const result = computeEligibility({
      doctors: [doctor(1)],
      unavailability: new Map(),
      days: [day('2026-10-01'), day('2026-10-02'), day('2026-10-03')],
      ...empty(),
      slots: { openDutySlots: 3, postOpenDutySlots: 4, closedDutySlots: 1 },
      minimums: { openDutyMinimum: 2, postOpenDutyMinimum: 3, closedDutyMinimum: 1 },
    })
    expect(result.map((d) => [d.date, d.slotsRequired, d.slotsMinimum])).toEqual([
      ['2026-10-01', 1, 1],
      ['2026-10-02', 3, 2],
      ['2026-10-03', 4, 3],
    ])
  })

  it('unavailable: an unavailability range containing the date -> excluded', () => {
    const result = computeEligibility({
      doctors: [doctor(1)],
      unavailability: new Map([[1, [{ start: '2026-09-09', end: '2026-09-12' }]]]),
      days: [day('2026-09-10')],
      ...empty(),
    })
    expect(result[0]?.eligibleDoctorIds).toEqual([])
  })

  it('at cap: dutyCountByDoctor >= maxMonthlyDuties -> excluded', () => {
    const result = computeEligibility({
      doctors: [doctor(1, 7)],
      unavailability: new Map(),
      days: [day('2026-09-10')],
      ...empty(),
      dutyCountByDoctor: new Map([[1, 7]]),
    })
    expect(result[0]?.eligibleDoctorIds).toEqual([])
  })

  it('own-duty exclusion: assigned today reduces count by 1 -> back under cap -> included', () => {
    const result = computeEligibility({
      doctors: [doctor(1, 7)],
      unavailability: new Map(),
      days: [day('2026-09-10')],
      ...empty(),
      dutiesByDate: new Map([['2026-09-10', new Set([1])]]),
      dutyCountByDoctor: new Map([[1, 7]]),
    })
    expect(result[0]?.eligibleDoctorIds).toEqual([1])
  })

  it('back-to-back: doctor on prevDate or nextDate -> excluded', () => {
    // previous day already assigned
    const fromPrev = computeEligibility({
      doctors: [doctor(1)],
      unavailability: new Map(),
      days: [day('2026-09-10')],
      ...empty(),
      dutiesByDate: new Map([['2026-09-09', new Set([1])]]),
    })
    expect(fromPrev[0]?.eligibleDoctorIds).toEqual([])
    // next day already assigned
    const fromNext = computeEligibility({
      doctors: [doctor(1)],
      unavailability: new Map(),
      days: [day('2026-09-10')],
      ...empty(),
      dutiesByDate: new Map([['2026-09-11', new Set([1])]]),
    })
    expect(fromNext[0]?.eligibleDoctorIds).toEqual([])
  })

  it('open on-call cap: a doctor holding an open-day duty -> excluded from other open days', () => {
    // Defaults: anchor 2026-10-02, interval 8 - 10-02 and 10-10 are open.
    const result = computeEligibility({
      doctors: [doctor(1)],
      unavailability: new Map(),
      days: [day('2026-10-02'), day('2026-10-10')],
      ...empty(),
      dutiesByDate: new Map([['2026-10-02', new Set([1])]]),
      dutyCountByDoctor: new Map([[1, 1]]),
      openByDoctor: new Map([[1, 1]]),
    })
    // On their own open day the doctor stays eligible (swap semantics);
    // on another open day they are excluded - never a second open duty.
    expect(result[0]?.eligibleDoctorIds).toEqual([1])
    expect(result[1]?.eligibleDoctorIds).toEqual([])
  })

  it('holiday cap: a critical holiday day stays open to a doctor holding two regular holiday duties', () => {
    // 10-03 is the day after the open anchor (critical); 10-17 is a regular Saturday.
    const result = computeEligibility({
      doctors: [doctor(1)],
      unavailability: new Map(),
      days: [day('2026-10-03', true), day('2026-10-17', true)],
      ...empty(),
      dutyCountByDoctor: new Map([[1, 2]]),
      regularHolidayByDoctor: new Map([[1, 2]]),
    })
    expect(result[0]?.eligibleDoctorIds).toEqual([1])
    expect(result[1]?.eligibleDoctorIds).toEqual([])
  })

  it('holiday cap: critical holiday duties leave less room for regular ones', () => {
    const result = computeEligibility({
      doctors: [doctor(1)],
      unavailability: new Map(),
      days: [day('2026-10-17', true)],
      ...empty(),
      dutyCountByDoctor: new Map([[1, 2]]),
      regularHolidayByDoctor: new Map([[1, 1]]),
      criticalHolidayByDoctor: new Map([[1, 1]]),
    })
    expect(result[0]?.eligibleDoctorIds).toEqual([])
  })

  it('empty: when no doctor passes -> eligibleDoctorIds is []', () => {
    const result = computeEligibility({
      doctors: [doctor(1, 7), doctor(2, 7)],
      unavailability: new Map(),
      days: [day('2026-09-10')],
      ...empty(),
      dutyCountByDoctor: new Map([
        [1, 7],
        [2, 7],
      ]),
    })
    expect(result[0]?.eligibleDoctorIds).toEqual([])
  })
})
