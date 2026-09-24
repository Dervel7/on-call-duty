import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  daysInMonth,
  eachDay,
  groupConsecutiveDays,
  isWeekend,
  monthRange,
  nextMonthIso,
  required,
} from '../index'

afterEach(() => vi.useRealTimers())

describe('isWeekend', () => {
  it('returns true for a Saturday', () => {
    expect(isWeekend(new Date(2026, 7, 8))).toBe(true)
  })

  it('returns false for a Wednesday', () => {
    expect(isWeekend(new Date(2026, 7, 5))).toBe(false)
  })
})

describe('daysInMonth', () => {
  it('returns 29 for February in a leap year', () => {
    expect(daysInMonth(2024, 1)).toBe(29)
  })
})

describe('required', () => {
  it('throws when value is undefined', () => {
    expect(() => required('FOO', undefined)).toThrow('FOO is required')
  })

  it('returns value when defined', () => {
    expect(required('FOO', 'bar')).toBe('bar')
  })
})

describe('eachDay', () => {
  it('expands an inclusive single-day range', () => {
    expect(eachDay('2026-09-07', '2026-09-07')).toEqual(['2026-09-07'])
  })

  it('expands across a month boundary', () => {
    expect(eachDay('2026-09-30', '2026-10-02')).toEqual([
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ])
  })

  it('returns nothing for an inverted range', () => {
    expect(eachDay('2026-09-03', '2026-09-01')).toEqual([])
  })
})

describe('groupConsecutiveDays', () => {
  it('groups a single run into one range', () => {
    expect(groupConsecutiveDays(['2026-09-07', '2026-09-08', '2026-09-09'])).toEqual([
      { startDate: '2026-09-07', endDate: '2026-09-09' },
    ])
  })

  it('splits unordered, duplicated days at gaps', () => {
    expect(
      groupConsecutiveDays(['2026-09-11', '2026-09-07', '2026-09-10', '2026-09-07']),
    ).toEqual([
      { startDate: '2026-09-07', endDate: '2026-09-07' },
      { startDate: '2026-09-10', endDate: '2026-09-11' },
    ])
  })

  it('returns an empty list for no days', () => {
    expect(groupConsecutiveDays([])).toEqual([])
  })
})

describe('nextMonthIso', () => {
  it('rolls over to January of the next year', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 11, 15) })
    expect(nextMonthIso()).toBe('2027-01')
  })
})

describe('monthRange', () => {
  it('returns inclusive bounds of the month', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })

  it('returns empty bounds when no month is selected', () => {
    expect(monthRange('')).toEqual({})
  })
})
