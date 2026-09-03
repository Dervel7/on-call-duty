import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
}))

import { errorHandler } from '../middleware/error-handler'
import { signAccessToken } from '../lib/jwt'
import { usageRouter } from '../routes/usage.routes'

function build() {
  const app = express()
  app.use(express.json())
  app.use('/usage', usageRouter)
  app.use(errorHandler)
  return app
}

const superadminToken = () => signAccessToken({ sub: 1, role: 'superadmin' })
const adminToken = () => signAccessToken({ sub: 2, role: 'administrator' })
const doctorToken = () => signAccessToken({ sub: 10, role: 'doctor' })

beforeEach(() => query.mockReset())

describe('usage routes', () => {
  it('unauthenticated is 401', async () => {
    const res = await request(build()).get('/usage/summary')
    expect(res.status).toBe(401)
  })

  it('administrator is forbidden from the usage summary (403)', async () => {
    const res = await request(build())
      .get('/usage/summary')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(403)
  })

  it('doctor is forbidden from the usage summary (403)', async () => {
    const res = await request(build())
      .get('/usage/summary')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(res.status).toBe(403)
  })

  it('superadmin reads the usage summary (200, license allowance present)', async () => {
    query.mockResolvedValue({ rows: [{ n: 3 }] })
    const res = await request(build())
      .get('/usage/summary')
      .set('Authorization', `Bearer ${superadminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(typeof res.body.data.summary.license.doctorAllowance).toBe('number')
    expect(res.body.data.summary.rollingDistinctDoctors).toBe(3)
    expect(res.body.data.summary.openAlerts).toBe(3)
  })

  it('superadmin resolving a missing alert is 404', async () => {
    query.mockResolvedValue({ rows: [] })
    const res = await request(build())
      .patch('/usage/alerts/999999/resolve')
      .set('Authorization', `Bearer ${superadminToken()}`)
    expect(res.status).toBe(404)
  })

  it('POST /generate-presses is 401 unauthenticated', async () => {
    const res = await request(build()).post('/usage/generate-presses')
    expect(res.status).toBe(401)
  })

  it('POST /generate-presses is 403 for a doctor', async () => {
    const res = await request(build())
      .post('/usage/generate-presses')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(res.status).toBe(403)
  })

  it('POST /generate-presses records the authenticated admin (204)', async () => {
    query.mockResolvedValue({ rows: [] })
    const res = await request(build())
      .post('/usage/generate-presses')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(204)
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0]![1]).toEqual([2])
  })

  it('POST /generate-presses also accepts a superadmin (204)', async () => {
    query.mockResolvedValue({ rows: [] })
    const res = await request(build())
      .post('/usage/generate-presses')
      .set('Authorization', `Bearer ${superadminToken()}`)
    expect(res.status).toBe(204)
  })

  it('GET /generate-presses is 403 for an administrator', async () => {
    const res = await request(build())
      .get('/usage/generate-presses')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(403)
  })

  it('GET /generate-presses is 403 for a doctor', async () => {
    const res = await request(build())
      .get('/usage/generate-presses')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(res.status).toBe(403)
  })

  it('GET /generate-presses returns totals for a superadmin (200)', async () => {
    query.mockResolvedValue({
      rows: [
        { user_id: 2, username: 'admin1', first_name: 'Ada', last_name: 'Lovelace', presses: 14 },
        { user_id: 3, username: 'admin2', first_name: 'Sam', last_name: 'Doe', presses: 9 },
      ],
    })
    const res = await request(build())
      .get('/usage/generate-presses')
      .set('Authorization', `Bearer ${superadminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.total).toBe(23)
    expect(res.body.data.byUser).toHaveLength(2)
    expect(res.body.data.byUser[0]).toMatchObject({ userId: 2, presses: 14 })
  })
})
