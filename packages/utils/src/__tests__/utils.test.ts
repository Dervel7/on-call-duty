import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  coveredDays,
  daysInMonth,
  eachDay,
  expandDays,
  formatRange,
  groupConsecutiveDays,
  isWeekend,
  monthGrid,
  monthLabel,
  monthNames,
  monthRange,
  nextMonthIso,
  required,
  toIsoMonth,
  weekdayNames,
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

describe('monthLabel', () => {
  it('names a 1-based month in the given locale', () => {
    expect(monthLabel(2026, 1, 'en-GB')).toBe('January 2026')
    expect(monthLabel('2026', 12, 'en-GB')).toBe('December 2026')
    expect(monthLabel(2026, 10, 'el-GR')).toBe('Οκτώβριος 2026')
  })
})

describe('monthNames', () => {
  it('lists the months January first', () => {
    const en = monthNames('en-GB')
    expect(en).toHaveLength(12)
    expect([en[0], en[11]]).toEqual(['January', 'December'])
  })

  it('uses the standalone (nominative) Greek form, not the genitive', () => {
    expect(monthNames('el-GR')[9]).toBe('Οκτώβριος')
  })

  it('keeps short Greek names distinct (June vs July)', () => {
    const short = monthNames('el-GR', 'short')
    expect(new Set(short).size).toBe(12)
    expect([short[5], short[6]]).toEqual(['Ιουν', 'Ιουλ'])
  })
})

describe('weekdayNames', () => {
  it('lists short weekdays Monday first', () => {
    expect(weekdayNames('en-GB')).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(weekdayNames('el-GR')[0]).toBe('Δευ')
  })
})

describe('toIsoMonth', () => {
  it('zero-pads the 1-based month', () => {
    expect(toIsoMonth(2026, 0)).toBe('2026-01')
    expect(toIsoMonth(2026, 11)).toBe('2026-12')
  })
})

describe('monthGrid', () => {
  it('starts on Monday and pads to whole weeks', () => {
    // June 2026 starts on a Monday and has 30 days: no lead, 5 trailing blanks.
    const grid = monthGrid(2026, 5)
    expect(grid).toHaveLength(35)
    expect(grid[0]).toEqual({ iso: '2026-06-01', day: 1, weekend: false })
    expect(grid[29]?.iso).toBe('2026-06-30')
    expect(grid.slice(30)).toEqual([null, null, null, null, null])
  })

  it('leads with blanks before the first weekday and flags weekends', () => {
    // February 2026 starts on a Sunday: six leading blanks.
    const grid = monthGrid(2026, 1)
    expect(grid.slice(0, 6)).toEqual([null, null, null, null, null, null])
    expect(grid[6]).toEqual({ iso: '2026-02-01', day: 1, weekend: true })
    expect(grid[7]?.weekend).toBe(false)
    expect(grid.length % 7).toBe(0)
  })
})

describe('formatRange', () => {
  it('shows a single day alone and a span with an arrow', () => {
    expect(formatRange({ startDate: '2026-09-07', endDate: '2026-09-07' })).toBe('2026-09-07')
    expect(formatRange({ startDate: '2026-09-07', endDate: '2026-09-09' })).toBe(
      '2026-09-07 → 2026-09-09',
    )
  })
})

describe('expandDays', () => {
  const a = { id: 1, startDate: '2026-09-29', endDate: '2026-10-02' }
  const b = { id: 2, startDate: '2026-09-28', endDate: '2026-09-30' }

  it('clips to bounds, keeps the first covering record and sorts by day', () => {
    expect(expandDays([a, b], '2026-09-30', '2026-10-01')).toEqual([
      { iso: '2026-09-30', record: a },
      { iso: '2026-10-01', record: a },
    ])
    expect(expandDays([a, b]).map((d) => [d.iso, d.record.id])).toEqual([
      ['2026-09-28', 2],
      ['2026-09-29', 1],
      ['2026-09-30', 1],
      ['2026-10-01', 1],
      ['2026-10-02', 1],
    ])
  })
})

describe('coveredDays', () => {
  it('lists days of every record except the excluded one', () => {
    const records = [
      { id: 1, startDate: '2026-09-01', endDate: '2026-09-02' },
      { id: 2, startDate: '2026-09-05', endDate: '2026-09-05' },
    ]
    expect(coveredDays(records, 1)).toEqual(['2026-09-05'])
    expect(coveredDays(records, null)).toEqual(['2026-09-01', '2026-09-02', '2026-09-05'])
  })
})
