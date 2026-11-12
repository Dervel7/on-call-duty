import { describe, expect, it } from 'vitest'
import {
  daysInMonth,
  isOpenDutyDate,
  isPostOpenDutyDate,
  minimumForDate,
  nextDate,
  prevDate,
  requiresDoubleCoverage,
  slotsForDate,
} from '../dates.ts'

const ANCHOR = '2026-10-02'

describe('isOpenDutyDate', () => {
  it('the anchor itself is open', () => {
    expect(isOpenDutyDate(ANCHOR, ANCHOR, 8)).toBe(true)
  })

  it('every whole interval after the anchor is open (8-day cycle)', () => {
    expect(isOpenDutyDate('2026-10-10', ANCHOR, 8)).toBe(true)
    expect(isOpenDutyDate('2026-10-18', ANCHOR, 8)).toBe(true)
    expect(isOpenDutyDate('2026-10-26', ANCHOR, 8)).toBe(true)
    expect(isOpenDutyDate('2026-11-11', ANCHOR, 8)).toBe(true) // 40 days, wraps the month
  })

  it('off-cycle days after the anchor are closed', () => {
    expect(isOpenDutyDate('2026-10-03', ANCHOR, 8)).toBe(false)
    expect(isOpenDutyDate('2026-10-09', ANCHOR, 8)).toBe(false)
    expect(isOpenDutyDate('2026-10-11', ANCHOR, 8)).toBe(false)
  })

  it('days before the anchor are closed, even whole intervals before it', () => {
    expect(isOpenDutyDate('2026-10-01', ANCHOR, 8)).toBe(false)
    expect(isOpenDutyDate('2026-09-24', ANCHOR, 8)).toBe(false) // anchor - 8
  })

  it('interval 1 makes every day from the anchor open', () => {
    expect(isOpenDutyDate('2026-10-01', ANCHOR, 1)).toBe(false)
    expect(isOpenDutyDate(ANCHOR, ANCHOR, 1)).toBe(true)
    expect(isOpenDutyDate('2027-03-19', ANCHOR, 1)).toBe(true)
  })

  it('the interval is configuration, not a constant', () => {
    expect(isOpenDutyDate('2026-10-05', ANCHOR, 3)).toBe(true)
    expect(isOpenDutyDate('2026-10-04', ANCHOR, 3)).toBe(false)
  })
})

describe('isPostOpenDutyDate', () => {
  const cycle = { anchorDate: ANCHOR, intervalDays: 8 }

  it('the day right after an open day is post-open, including across months', () => {
    expect(isPostOpenDutyDate('2026-10-03', cycle)).toBe(true)
    expect(isPostOpenDutyDate('2026-11-12', cycle)).toBe(true) // after the 2026-11-11 open day
  })

  it('open days, the day before the anchor, and regular days are not post-open', () => {
    expect(isPostOpenDutyDate(ANCHOR, cycle)).toBe(false)
    expect(isPostOpenDutyDate('2026-10-01', cycle)).toBe(false)
    expect(isPostOpenDutyDate('2026-10-04', cycle)).toBe(false)
  })

  it('interval 1 makes every day open, so none is post-open', () => {
    expect(isPostOpenDutyDate('2026-10-03', { anchorDate: ANCHOR, intervalDays: 1 })).toBe(false)
  })
})

describe('daysInMonth', () => {
  it('handles leap and non-leap February and 30/31-day months', () => {
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2026, 4)).toBe(30)
    expect(daysInMonth(2026, 12)).toBe(31)
  })
})

describe('prevDate / nextDate', () => {
  it('cross year and month boundaries', () => {
    expect(prevDate('2027-01-01')).toBe('2026-12-31')
    expect(nextDate('2026-12-31')).toBe('2027-01-01')
    expect(nextDate('2028-02-28')).toBe('2028-02-29')
    expect(nextDate('2026-02-28')).toBe('2026-03-01')
  })
})

describe('day-type tiers', () => {
  const openDuty = { anchorDate: '2026-10-31', intervalDays: 8 }
  const slots = { openDutySlots: 3, postOpenDutySlots: 2, closedDutySlots: 1 }
  const minimums = { openDutyMinimum: 3, postOpenDutyMinimum: 2, closedDutyMinimum: 1 }

  it('requiresDoubleCoverage covers the open day and the day after it across a month boundary', () => {
    expect(requiresDoubleCoverage('2026-10-31', openDuty)).toBe(true)
    expect(requiresDoubleCoverage('2026-11-01', openDuty)).toBe(true)
    expect(requiresDoubleCoverage('2026-11-02', openDuty)).toBe(false)
  })

  it('slotsForDate picks the open, post-open and closed tier', () => {
    expect(slotsForDate('2026-10-31', openDuty, slots)).toBe(3)
    expect(slotsForDate('2026-11-01', openDuty, slots)).toBe(2)
    expect(slotsForDate('2026-11-02', openDuty, slots)).toBe(1)
  })

  it('minimumForDate picks the open, post-open and closed tier', () => {
    expect(minimumForDate('2026-10-31', openDuty, minimums)).toBe(3)
    expect(minimumForDate('2026-11-01', openDuty, minimums)).toBe(2)
    expect(minimumForDate('2026-11-02', openDuty, minimums)).toBe(1)
  })
})
