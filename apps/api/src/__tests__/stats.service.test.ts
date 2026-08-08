import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

const getByUserId = vi.fn()
vi.mock('../services/doctor.service', () => ({
  getByUserId: (...a: unknown[]) => getByUserId(...a),
}))

import { adminStats, meStats } from '../services/stats.service'

beforeEach(() => {
  query.mockReset()
  getByUserId.mockReset()
})

describe('stats.service — adminStats', () => {
  it('empty state when no schedule exists', async () => {
    query.mockResolvedValue({ rows: [] })
    const stats = await adminStats(2026, 8)
    expect(stats.schedule).toBeNull()
    expect(stats.coverage.filled).toBe(0)
    expect(stats.coverage.daysInMonth).toBe(31)
    expect(stats.coverage.gaps).toHaveLength(31)
    expect(stats.workload).toEqual([])
    expect(stats.fairness.dutySpread).toBeNull()
  })

  it('coverage counts filled + gaps; active doctor with 0 duties included', async () => {
    const assigned: string[] = []
    for (let d = 1; d <= 29; d++) assigned.push(`2026-09-${String(d).padStart(2, '0')}`)
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM schedules WHERE year'))
        return {
          rows: [
            {
              id: 1,
              year: 2026,
              month: 9,
              status: 'published',
              created_by: 2,
              created_at: new Date('2026-08-01'),
              updated_at: new Date('2026-08-01'),
            },
          ],
        }
      if (sql.includes('GROUP BY duty_date')) {
        const rows = assigned.map((duty_date) => ({ duty_date, n: 2 }))
        rows.push({ duty_date: '2026-09-30', n: 1 })
        return { rows }
      }
      if (sql.includes('WHERE u.is_active = TRUE'))
        return { rows: [{ id: 5, first_name: 'Jane', last_name: 'Roe', max_monthly_duties: 7 }] }
      if (sql.includes('GROUP BY doctor_id'))
        return { rows: [{ doctor_id: 5, total: 29, weekend: 8, holiday: 1 }] }
      if (sql.includes('u.is_active = FALSE')) return { rows: [] }
      return { rows: [] }
    })
    const stats = await adminStats(2026, 9)
    expect(stats.coverage.daysInMonth).toBe(30)
    expect(stats.coverage.filled).toBe(29)
    expect(stats.coverage.gaps).toEqual(['2026-09-30'])
    expect(stats.workload).toHaveLength(1)
    expect(stats.workload[0]!.duties).toBe(29)
    expect(stats.workload[0]!.weekday).toBe(21)
    expect(stats.fairness.dutySpread).toBeNull()
  })

  it('inactive doctor with duties is included and flagged isActive=false', async () => {
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM schedules WHERE year'))
        return {
          rows: [
            {
              id: 1,
              year: 2026,
              month: 9,
              status: 'draft',
              created_by: 2,
              created_at: new Date('2026-08-01'),
              updated_at: new Date('2026-08-01'),
            },
          ],
        }
      if (sql.includes('GROUP BY duty_date')) return { rows: [{ duty_date: '2026-09-01', n: 1 }] }
      if (sql.includes('WHERE u.is_active = TRUE'))
        return { rows: [{ id: 5, first_name: 'Jane', last_name: 'Roe', max_monthly_duties: 7 }] }
      if (sql.includes('GROUP BY doctor_id'))
        return { rows: [{ doctor_id: 6, total: 1, weekend: 0, holiday: 0 }] }
      if (sql.includes('u.is_active = FALSE'))
        return { rows: [{ id: 6, first_name: 'Old', last_name: 'Doc', max_monthly_duties: 7 }] }
      return { rows: [] }
    })
    const stats = await adminStats(2026, 9)
    const inactive = stats.workload.find((w) => w.doctorId === 6)
    expect(inactive).toBeDefined()
    expect(inactive!.isActive).toBe(false)
    expect(inactive!.duties).toBe(1)
  })

  it('fairness spread = max - min over doctors with duties > 0', async () => {
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM schedules WHERE year'))
        return {
          rows: [
            {
              id: 1,
              year: 2026,
              month: 9,
              status: 'published',
              created_by: 2,
              created_at: new Date('2026-08-01'),
              updated_at: new Date('2026-08-01'),
            },
          ],
        }
      if (sql.includes('GROUP BY duty_date')) return { rows: [{ duty_date: '2026-09-01', n: 1 }] }
      if (sql.includes('WHERE u.is_active = TRUE'))
        return {
          rows: [
            { id: 1, first_name: 'A', last_name: 'A', max_monthly_duties: 7 },
            { id: 2, first_name: 'B', last_name: 'B', max_monthly_duties: 7 },
            { id: 3, first_name: 'C', last_name: 'C', max_monthly_duties: 7 },
          ],
        }
      if (sql.includes('GROUP BY doctor_id'))
        return {
          rows: [
            { doctor_id: 1, total: 5, weekend: 2, holiday: 0 },
            { doctor_id: 2, total: 7, weekend: 1, holiday: 1 },
          ],
        }
      if (sql.includes('u.is_active = FALSE')) return { rows: [] }
      return { rows: [] }
    })
    const stats = await adminStats(2026, 9)
    expect(stats.fairness.dutySpread).toBe(2)
    expect(stats.fairness.weekendSpread).toBe(1)
  })
})

describe('stats.service — meStats', () => {
  it('404 when no doctor profile (admin case)', async () => {
    getByUserId.mockRejectedValue(Object.assign(new Error('Doctor not found'), { status: 404 }))
    await expect(meStats(99)).rejects.toMatchObject({ status: 404 })
  })

  it('currentMonth.published=false with zeros when no published schedule', async () => {
    getByUserId.mockResolvedValue({ id: 5, firstName: 'Jane', lastName: 'Roe', maxMonthlyDuties: 7 })
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM schedules WHERE status')) return { rows: [] }
      if (sql.includes('FILTER (WHERE du.is_weekend)'))
        return { rows: [{ total: 0, weekend: 0, holiday: 0 }] }
      if (sql.includes('du.duty_date >= $2')) return { rows: [] }
      if (sql.includes('du.duty_date BETWEEN')) return { rows: [] }
      return { rows: [] }
    })
    const me = await meStats(5)
    expect(me.currentMonth.published).toBe(false)
    expect(me.currentMonth.duties).toBe(0)
    expect(me.upcoming).toEqual([])
    expect(me.onCall).toEqual([])
  })

  it('counts + upcoming + onCall (isMine) when published', async () => {
    getByUserId.mockResolvedValue({ id: 5, firstName: 'Jane', lastName: 'Roe', maxMonthlyDuties: 7 })
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM schedules WHERE status')) return { rows: [{ '?column?': 1 }] }
      if (sql.includes('FILTER (WHERE du.is_weekend)'))
        return { rows: [{ total: 4, weekend: 1, holiday: 0 }] }
      if (sql.includes('du.duty_date >= $2'))
        return { rows: [{ duty_date: '2099-01-01', is_weekend: false, is_holiday: false }] }
      if (sql.includes('du.duty_date BETWEEN'))
        return {
          rows: [
            {
              duty_date: '2099-01-01',
              is_weekend: false,
              is_holiday: false,
              first_name: 'Jane',
              last_name: 'Roe',
              doctor_id: 5,
            },
            {
              duty_date: '2099-01-02',
              is_weekend: true,
              is_holiday: false,
              first_name: 'Other',
              last_name: 'Doc',
              doctor_id: 6,
            },
          ],
        }
      return { rows: [] }
    })
    const me = await meStats(5)
    expect(me.currentMonth.published).toBe(true)
    expect(me.currentMonth.duties).toBe(4)
    expect(me.upcoming).toHaveLength(1)
    expect(me.onCall).toHaveLength(2)
    expect(me.onCall[0]!.isMine).toBe(true)
    expect(me.onCall[1]!.isMine).toBe(false)
  })
})
