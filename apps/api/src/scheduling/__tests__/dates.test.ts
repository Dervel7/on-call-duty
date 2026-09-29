import { describe, expect, it } from 'vitest'
import { isOpenDutyDate } from '../dates'

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
