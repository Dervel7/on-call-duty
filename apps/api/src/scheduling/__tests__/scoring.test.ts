import { describe, expect, it } from 'vitest'
import {
  W_FRIDAY,
  W_WEEKEND,
  W_WORKLOAD,
  fridayBudget,
  scoreCandidate,
  weekendBudget,
} from '../scoring'
import type { DaySpec, DoctorSpec } from '../types'

const doctor = (id: number, max: number): DoctorSpec => ({
  id,
  firstName: 'A',
  lastName: 'B',
  maxMonthlyDuties: max,
  isActive: true,
})
const weekday = (d: string): DaySpec => ({ date: d, dayOfWeek: 3, isWeekend: false })
const weekend = (d: string): DaySpec => ({ date: d, dayOfWeek: 6, isWeekend: true })
const friday = (d: string): DaySpec => ({ date: d, dayOfWeek: 5, isWeekend: false })

describe('scoring', () => {
  it('budgets use 2-slots/day ceiling division and 0 on no doctors', () => {
    expect(weekendBudget(8, 3)).toBe(6) // ceil(16/3)
    expect(weekendBudget(9, 3)).toBe(6) // ceil(18/3)
    expect(weekendBudget(8, 0)).toBe(0)
    expect(fridayBudget(4, 8)).toBe(1) // ceil(8/8)
    expect(fridayBudget(0, 8)).toBe(0)
  })

  it('workload term favors doctors with more remaining slots', () => {
    const s0 = scoreCandidate(doctor(1, 7), weekday('2026-09-01'), 0, 0, 0, 0, 0)
    const s6 = scoreCandidate(doctor(1, 7), weekday('2026-09-01'), 6, 0, 0, 0, 0)
    expect(s0.workload).toBe(7 * W_WORKLOAD)
    expect(s6.workload).toBe(1 * W_WORKLOAD)
    expect(s0.score - s6.score).toBe(6 * W_WORKLOAD)
  })

  it('weekend term only applies on weekend days and clamps at 0', () => {
    const onWeekend = scoreCandidate(doctor(1, 7), weekend('2026-09-05'), 0, 2, 0, 3, 0)
    const overServed = scoreCandidate(doctor(1, 7), weekend('2026-09-05'), 0, 5, 0, 3, 0)
    expect(onWeekend.weekend).toBe((3 - 2) * W_WEEKEND)
    expect(overServed.weekend).toBe(0)
    expect(scoreCandidate(doctor(1, 7), weekday('2026-09-01'), 0, 0, 0, 3, 0).weekend).toBe(0)
  })

  it('friday term only applies on Fridays (dayOfWeek 5) and clamps at 0', () => {
    expect(scoreCandidate(doctor(1, 7), friday('2026-09-04'), 0, 0, 0, 0, 2).friday).toBe(
      2 * W_FRIDAY,
    )
    expect(scoreCandidate(doctor(1, 7), weekday('2026-09-03'), 0, 0, 0, 0, 2).friday).toBe(0)
    const overServed = scoreCandidate(doctor(1, 7), friday('2026-09-04'), 0, 0, 3, 0, 2)
    expect(overServed.friday).toBe(0)
  })
})
