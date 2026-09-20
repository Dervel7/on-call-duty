import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const adminStats = vi.fn()
const meStats = vi.fn()
vi.mock('../services/stats.service', () => ({
  adminStats: (...a: unknown[]) => adminStats(...a),
  meStats: (...a: unknown[]) => meStats(...a),
  currentYearMonthUTC: () => {
    const now = new Date()
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }
  },
}))
vi.mock('../services/billing.service', () => ({ isLocked: async () => false }))


import { errorHandler } from '../middleware/error-handler'
import { signAccessToken } from '../lib/jwt'
import { statsRouter } from '../routes/stats.routes'

function build() {
  const app = express()
  app.use(express.json())
  app.use('/stats', statsRouter)
  app.use(errorHandler)
  return app
}

const adminToken = () => signAccessToken({ sub: 1, role: 'administrator', clinicId: 1 })
const doctorToken = () => signAccessToken({ sub: 10, role: 'doctor', clinicId: 10 })
const managerToken = () => signAccessToken({ sub: 2, role: 'manager', clinicId: null })
const superadminToken = () => signAccessToken({ sub: 3, role: 'superadmin', clinicId: null })

const emptyStats = () => ({
  year: 2026,
  month: 8,
  schedule: null,
  coverage: { daysInMonth: 31, filled: 0, gaps: [] },
  workload: [],
  fairness: { dutySpread: null, weekendSpread: null },
})

beforeEach(() => {
  adminStats.mockReset()
  meStats.mockReset()
})

describe('stats routes', () => {
  it('admin 200; doctor 403; unauth 401', async () => {
    adminStats.mockResolvedValue(emptyStats())
    const ok200 = await request(build())
      .get('/stats/admin')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(ok200.status).toBe(200)
    expect(ok200.body.data.stats).toBeDefined()

    const forbidden = await request(build())
      .get('/stats/admin')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(forbidden.status).toBe(403)

    const unauth = await request(build()).get('/stats/admin')
    expect(unauth.status).toBe(401)
  })

  it('admin query validation rejects invalid month with 400', async () => {
    const res = await request(build())
      .get('/stats/admin?month=13')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(400)
  })

  it('admin without query resolves to the current month', async () => {
    adminStats.mockResolvedValue(emptyStats())
    await request(build())
      .get('/stats/admin')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(adminStats).toHaveBeenCalledTimes(1)
    const now = new Date()
    expect(adminStats.mock.calls[0]?.[0]).toBe(now.getUTCFullYear())
  })

  it('I15: manager without clinicId gets 400; with clinicId sees that clinic (I16)', async () => {
    adminStats.mockResolvedValue(emptyStats())
    const bad = await request(build())
      .get('/stats/admin')
      .set('Authorization', `Bearer ${managerToken()}`)
    expect(bad.status).toBe(400)
    expect(adminStats).not.toHaveBeenCalled()

    const good = await request(build())
      .get('/stats/admin?clinicId=2')
      .set('Authorization', `Bearer ${managerToken()}`)
    expect(good.status).toBe(200)
    expect(adminStats).toHaveBeenCalledTimes(1)
    expect(adminStats.mock.calls[0]?.[2]).toEqual({ kind: 'clinic', clinicId: 2 })
  })

  it('superadmin without clinicId gets 400 (scope is explicit, never global)', async () => {
    const res = await request(build())
      .get('/stats/admin')
      .set('Authorization', `Bearer ${superadminToken()}`)
    expect(res.status).toBe(400)
  })

  it('administrator passing a foreign clinicId gets 403; own clinicId is forced', async () => {
    adminStats.mockResolvedValue(emptyStats())
    const forbidden = await request(build())
      .get('/stats/admin?clinicId=9')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(forbidden.status).toBe(403)

    await request(build())
      .get('/stats/admin')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(adminStats.mock.calls[0]?.[2]).toEqual({ kind: 'clinic', clinicId: 1 })
  })

  it('me 200 for doctor; 404 for admin (no profile); 401 unauth', async () => {
    meStats.mockResolvedValue({
      doctor: { id: 10, firstName: 'Jane', lastName: 'Roe', maxMonthlyDuties: 7 },
      currentMonth: {
        year: 2026,
        month: 8,
        published: false,
        duties: 0,
        weekend: 0,
        maxMonthly: 7,
      },
      upcoming: [],
      onCall: [],
    })
    const ok200 = await request(build())
      .get('/stats/me')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(ok200.status).toBe(200)

    meStats.mockRejectedValue(Object.assign(new Error('Doctor not found'), { status: 404 }))
    const notFound = await request(build())
      .get('/stats/me')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(notFound.status).toBe(404)

    const unauth = await request(build()).get('/stats/me')
    expect(unauth.status).toBe(401)
  })
})
