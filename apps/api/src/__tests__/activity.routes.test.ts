import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const list = vi.fn()
vi.mock('../services/activity.service', () => ({
  list: (...a: unknown[]) => list(...a),
}))
vi.mock('../services/billing.service', () => ({ isLocked: async () => false }))


import { signAccessToken } from '../lib/jwt'
import { errorHandler } from '../middleware/error-handler'
import { activityRouter } from '../routes/activity.routes'

function build() {
  const app = express()
  app.use(express.json())
  app.use('/activity', activityRouter)
  app.use(errorHandler)
  return app
}

const adminToken = () => signAccessToken({ sub: 1, role: 'administrator' })
const doctorToken = () => signAccessToken({ sub: 10, role: 'doctor' })

beforeEach(() => list.mockReset())

describe('activity routes', () => {
  it('admin lists activity (200); unauthenticated is 401; doctor is 403', async () => {
    list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 50 })
    const ok200 = await request(build())
      .get('/activity')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(ok200.status).toBe(200)
    expect(ok200.body.data.activity.total).toBe(0)

    const unauth = await request(build()).get('/activity')
    expect(unauth.status).toBe(401)

    const forbidden = await request(build())
      .get('/activity')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(forbidden.status).toBe(403)
  })

  it('passes validated query filters to the service', async () => {
    list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 50 })
    const res = await request(build())
      .get('/activity?action=auth.login&userId=2&from=2026-08-01&to=2026-08-31&page=3&limit=25')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(list).toHaveBeenCalledWith({
      action: 'auth.login',
      userId: 2,
      from: '2026-08-01',
      to: '2026-08-31',
      page: 3,
      limit: 25,
    })
  })

  it('rejects invalid query with 400', async () => {
    const res = await request(build())
      .get('/activity?action=bogus.action')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(400)
  })
})
