import { beforeEach, describe, expect, it, vi } from 'vitest'

const adminStats = vi.fn()
vi.mock('../services/stats.service', () => ({
  adminStats: (...a: unknown[]) => adminStats(...a),
}))

const getScheduleDuties = vi.fn()
vi.mock('../services/schedule.service', () => ({
  getScheduleDuties: (...a: unknown[]) => getScheduleDuties(...a),
}))

import { monthlyReport } from '../services/reports.service'

beforeEach(() => {
  adminStats.mockReset()
  getScheduleDuties.mockReset()
})

describe('reports.service — monthlyReport', () => {
  it('empty state: schedule null -> roster empty and getScheduleDuties not called', async () => {
    adminStats.mockResolvedValue({
      schedule: null,
      coverage: { daysInMonth: 31, filled: 0, gaps: [] },
      workload: [],
      fairness: { dutySpread: null, weekendSpread: null },
    })

    const report = await monthlyReport(2026, 8)

    expect(report.schedule).toBeNull()
    expect(report.roster).toEqual([])
    expect(getScheduleDuties).not.toHaveBeenCalled()
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('with schedule: composes roster from getScheduleDuties and forwards stats fields', async () => {
    const schedule = {
      id: 7,
      year: 2026,
      month: 9,
      status: 'draft',
      createdBy: 1,
      createdAt: '',
      updatedAt: '',
    }
    adminStats.mockResolvedValue({
      schedule,
      coverage: { daysInMonth: 30, filled: 30, gaps: [] },
      workload: [
        {
          doctorId: 1,
          firstName: 'Jane',
          lastName: 'Roe',
          isActive: true,
          maxMonthly: 7,
          duties: 8,
          weekday: 6,
          weekend: 2,
        },
      ],
      fairness: { dutySpread: 0, weekendSpread: 0 },
    })
    const duties = [
      {
        id: 1,
        scheduleId: 7,
        dutyDate: '2026-09-01',
        doctorId: 1,
        doctorFirstName: 'Jane',
        doctorLastName: 'Roe',
        isWeekend: false,
        reason: 'engine',
        createdAt: '',
      },
    ]
    getScheduleDuties.mockResolvedValue({ schedule, duties })

    const report = await monthlyReport(2026, 9)

    expect(getScheduleDuties).toHaveBeenCalledWith(7)
    expect(report.roster).toEqual(duties)
    expect(report.coverage.filled).toBe(30)
    expect(report.workload).toHaveLength(1)
    expect(report.fairness.dutySpread).toBe(0)
  })
})
