import { HOLIDAY_DUTY_CAP, holidayCapAllows, holidayExcess, isAvailable, underCap, underOpenDutyCap } from '../constraints.ts'

describe('constraints', () => {
  it('isAvailable respects inclusive ranges', () => {
    const ranges = [{ start: '2026-09-07', end: '2026-09-11' }]
    expect(isAvailable('2026-09-06', ranges)).toBe(true)
    expect(isAvailable('2026-09-07', ranges)).toBe(false)
    expect(isAvailable('2026-09-11', ranges)).toBe(false)
    expect(isAvailable('2026-09-12', ranges)).toBe(true)
    expect(isAvailable('2026-09-12', undefined)).toBe(true)
  })

  it('underCap is exclusive at the cap', () => {
    expect(underCap(0, 7)).toBe(true)
    expect(underCap(6, 7)).toBe(true)
    expect(underCap(7, 7)).toBe(false)
  })

  it('underOpenDutyCap allows the first open duty only', () => {
    expect(underOpenDutyCap(0)).toBe(true)
    expect(underOpenDutyCap(1)).toBe(false)
  })

  it('holiday cap: critical duties use up room first, regular ones get the rest', () => {
    expect(HOLIDAY_DUTY_CAP).toBe(2)
    expect(holidayCapAllows(2, 0)).toBe(true)
    expect(holidayCapAllows(3, 0)).toBe(false)
    expect(holidayCapAllows(1, 1)).toBe(true)
    expect(holidayCapAllows(2, 1)).toBe(false)
    // Critical duties alone never block, but leave no room for regular ones.
    expect(holidayCapAllows(0, 3)).toBe(true)
    expect(holidayCapAllows(1, 2)).toBe(false)
    expect(holidayExcess(3, 1)).toBe(2)
    expect(holidayExcess(1, 0)).toBe(0)
  })
})
