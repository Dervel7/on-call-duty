import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const monthlyReport = vi.fn()
vi.mock('../services/reports.service', () => ({
  monthlyReport: (...a: unknown[]) => monthlyReport(...a),
}))
vi.mock('../services/billing.service', () => ({ isLocked: async () => false }))

vi.mock('../services/stats.service', () => ({
  currentYearMonthUTC: () => {
    const now = new Date()
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }
  },
}))

import { errorHandler } from '../middleware/error-handler'
import { signAccessToken } from '../lib/jwt'
import { reportsRouter } from '../routes/reports.routes'

function build() {
  const app = express()
  app.use(express.json())
  app.use('/reports', reportsRouter)
  app.use(errorHandler)
  return app
}

const adminToken = () => signAccessToken({ sub: 1, role: 'administrator' })
const doctorToken = () => signAccessToken({ sub: 10, role: 'doctor' })

function emptyReport(overrides: Record<string, unknown> = {}) {
  return {
    year: 2026,
    month: 8,
    generatedAt: '2026-08-07T00:00:00.000Z',
    schedule: null,
    roster: [],
    coverage: { daysInMonth: 31, filled: 0, gaps: [] },
    workload: [],
    fairness: { dutySpread: null, weekendSpread: null, holidaySpread: null },
    holidays: [],
    ...overrides,
  }
}

beforeEach(() => {
  monthlyReport.mockReset()
})

describe('reports routes', () => {
  it('admin 200; doctor 403; unauth 401', async () => {
    monthlyReport.mockResolvedValue(emptyReport())
    const ok200 = await request(build())
      .get('/reports/monthly')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(ok200.status).toBe(200)
    expect(ok200.body.data.report).toBeDefined()

    const forbidden = await request(build())
      .get('/reports/monthly')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(forbidden.status).toBe(403)

    const unauth = await request(build()).get('/reports/monthly')
    expect(unauth.status).toBe(401)
  })

  it('rejects invalid month with 400', async () => {
    const res = await request(build())
      .get('/reports/monthly?month=13')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(400)
  })

  it('without query resolves to the current UTC month', async () => {
    monthlyReport.mockResolvedValue(emptyReport())
    await request(build())
      .get('/reports/monthly')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(monthlyReport).toHaveBeenCalledTimes(1)
    const now = new Date()
    expect(monthlyReport.mock.calls[0]?.[0]).toBe(now.getUTCFullYear())
    expect(monthlyReport.mock.calls[0]?.[1]).toBe(now.getUTCMonth() + 1)
  })

  it('passes explicit year/month through', async () => {
    monthlyReport.mockResolvedValue(emptyReport({ year: 2025, month: 12 }))
    await request(build())
      .get('/reports/monthly?year=2025&month=12')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(monthlyReport).toHaveBeenCalledWith(2025, 12)
  })
})
