import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

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
  query.mockReset()
  adminStats.mockReset()
  getScheduleDuties.mockReset()
})

describe('reports.service — monthlyReport', () => {
  it('empty state: schedule null -> roster empty, getById not called, holidays still queried', async () => {
    adminStats.mockResolvedValue({
      schedule: null,
      coverage: { daysInMonth: 31, filled: 0, gaps: [] },
      workload: [],
      fairness: { dutySpread: null, weekendSpread: null, holidaySpread: null },
    })
    query.mockResolvedValue({ rows: [] })

    const report = await monthlyReport(2026, 8)

    expect(report.schedule).toBeNull()
    expect(report.roster).toEqual([])
    expect(getScheduleDuties).not.toHaveBeenCalled()
    expect(report.holidays).toEqual([])
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // holidays query scoped to month bounds
    expect(query).toHaveBeenCalledTimes(1)
    const sql = String(query.mock.calls[0]?.[0])
    expect(sql).toContain('date >= $1 AND date <= $2')
    expect(query.mock.calls[0]?.[1]).toEqual(['2026-08-01', '2026-08-31'])
  })

  it('with schedule: composes roster from getScheduleDuties and forwards stats fields', async () => {
    const schedule = {
      id: 7,
      year: 2026,
      month: 9,
      status: 'published',
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
          duties: 7,
          weekday: 5,
          weekend: 2,
          holiday: 0,
        },
      ],
      fairness: { dutySpread: 0, weekendSpread: 0, holidaySpread: 0 },
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
        isHoliday: false,
        reason: 'engine',
        createdAt: '',
      },
    ]
    getScheduleDuties.mockResolvedValue({ schedule, duties })
    query.mockResolvedValue({ rows: [{ date: '2026-09-15', name: 'Mid-Autumn' }] })

    const report = await monthlyReport(2026, 9)

    expect(getScheduleDuties).toHaveBeenCalledWith(7)
    expect(report.roster).toEqual(duties)
    expect(report.coverage.filled).toBe(30)
    expect(report.workload).toHaveLength(1)
    expect(report.fairness.dutySpread).toBe(0)
    expect(report.holidays).toEqual([{ date: '2026-09-15', name: 'Mid-Autumn' }])
    // September month bounds
    expect(query.mock.calls[0]?.[1]).toEqual(['2026-09-01', '2026-09-30'])
  })
})
