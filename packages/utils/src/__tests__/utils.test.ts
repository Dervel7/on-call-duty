import { describe, expect, it } from 'vitest'
import { daysInMonth, isWeekend, required } from '../index'

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
