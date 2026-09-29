import { HOLIDAY_DUTY_CAP, isAvailable, notConsecutive, underCap, underHolidayCap } from '../constraints'

describe('constraints', () => {
  it('isAvailable respects inclusive ranges', () => {
    const ranges = [{ start: '2026-09-07', end: '2026-09-11' }]
    expect(isAvailable(1, '2026-09-06', ranges).ok).toBe(true)
    expect(isAvailable(1, '2026-09-07', ranges).ok).toBe(false)
    expect(isAvailable(1, '2026-09-11', ranges).ok).toBe(false)
    expect(isAvailable(1, '2026-09-12', ranges).ok).toBe(true)
    expect(isAvailable(1, '2026-09-12', undefined).ok).toBe(true)
  })

  it('underCap is exclusive at the cap', () => {
    expect(underCap(0, 7).ok).toBe(true)
    expect(underCap(6, 7).ok).toBe(true)
    expect(underCap(7, 7).ok).toBe(false)
  })

  it('underHolidayCap is exclusive at the cap (count < cap means eligible)', () => {
    expect(HOLIDAY_DUTY_CAP).toBe(2)
    expect(underHolidayCap(0).ok).toBe(true)
    expect(underHolidayCap(1).ok).toBe(true)
    expect(underHolidayCap(2).ok).toBe(false)
    expect(underHolidayCap(3).ok).toBe(false)
    expect(underHolidayCap(2).reason).toBe('at holiday cap')
    expect(underHolidayCap(0).reason).toBe('')
  })

  it('notConsecutive blocks only when on duty the previous day', () => {
    expect(notConsecutive(false).ok).toBe(true)
    expect(notConsecutive(true).ok).toBe(false)
  })
})
