import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
}))
// authenticate consults the billing lock on every request; route tests stub it unlocked.
vi.mock('../services/billing.service', () => ({ isLocked: async () => false }))


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
    const res = await request(build()).get('/usage/generations')
    expect(res.status).toBe(401)
  })

  it('administrator is forbidden from usage (403)', async () => {
    const res = await request(build())
      .get('/usage/generations')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(403)
  })

  it('doctor is forbidden from usage (403)', async () => {
    const res = await request(build())
      .get('/usage/alerts')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(res.status).toBe(403)
  })

  it('superadmin reads generation history (200)', async () => {
    query.mockResolvedValue({ rows: [] })
    const res = await request(build())
      .get('/usage/generations')
      .set('Authorization', `Bearer ${superadminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.generations).toEqual([])
  })

  it('superadmin resolving a missing alert is 404', async () => {
    query.mockResolvedValue({ rows: [] })
    const res = await request(build())
      .patch('/usage/alerts/999999/resolve')
      .set('Authorization', `Bearer ${superadminToken()}`)
    expect(res.status).toBe(404)
  })

  it('usage summary no longer exists (404)', async () => {
    const res = await request(build())
      .get('/usage/summary')
      .set('Authorization', `Bearer ${superadminToken()}`)
    expect(res.status).toBe(404)
  })
})
