import { describe, expect, it } from 'vitest'
import { toQuery } from '../services/query'

describe('toQuery', () => {
  it('returns an empty string when nothing is set', () => {
    expect(toQuery()).toBe('')
    expect(toQuery({ year: undefined, action: '' })).toBe('')
  })

  it('skips undefined and empty values and encodes the rest', () => {
    expect(toQuery({ year: 2026, month: undefined, action: 'a b&c', from: '' })).toBe(
      '?year=2026&action=a+b%26c',
    )
  })
})
