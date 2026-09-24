import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))
// authenticate consults the billing lock on every request; route tests stub it unlocked.
vi.mock('../services/billing.service', () => ({ isLocked: async () => false }))


const logActivity = vi.fn()
const recordActivity = vi.fn()
vi.mock('../services/activity.service', () => ({
  logActivity: (...a: unknown[]) => logActivity(...a),
  recordActivity: (...a: unknown[]) => recordActivity(...a),
}))

import { signAccessToken } from '../lib/jwt'
import { errorHandler } from '../middleware/error-handler'
import { unavailabilityRouter } from '../routes/unavailability.routes'

function build() {
  const app = express()
  app.use(express.json())
  app.use('/unavailability', unavailabilityRouter)
  app.use(errorHandler)
  return app
}

const adminToken = () => signAccessToken({ sub: 1, role: 'administrator', clinicId: 1 })
const superadminToken = () => signAccessToken({ sub: 2, role: 'superadmin', clinicId: null })
const doctorToken = () => signAccessToken({ sub: 10, role: 'doctor', clinicId: 10 })

const row = () => ({
  id: 1,
  doctor_id: 5,
  first_name: 'Jane',
  last_name: 'Roe',
  start_date: '2026-09-07',
  end_date: '2026-09-11',
  created_at: new Date(),
  updated_at: new Date(),
})

beforeEach(() => {
  query.mockReset()
  logActivity.mockReset()
  recordActivity.mockReset()
})

describe('unavailability routes', () => {
  it('admin lists all (200)', async () => {
    query.mockResolvedValue({ rows: [] })
    const res = await request(build())
      .get('/unavailability')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.data.unavailability).toEqual([])
  })

  it('doctor is forbidden from admin list (403)', async () => {
    const res = await request(build())
      .get('/unavailability')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(res.status).toBe(403)
  })

  it('manager reads with clinicId (200); 400 without; writes are 403 (I12/I14)', async () => {
    const managerToken = signAccessToken({ sub: 5, role: 'manager', clinicId: null })
    query.mockResolvedValue({ rows: [row()] })
    const okRes = await request(build())
      .get('/unavailability?clinicId=1')
      .set('Authorization', `Bearer ${managerToken}`)
    expect(okRes.status).toBe(200)
    expect(query.mock.calls[0]?.[1]).toEqual([1])

    const missing = await request(build())
      .get('/unavailability')
      .set('Authorization', `Bearer ${managerToken}`)
    expect(missing.status).toBe(400)

    const write = await request(build())
      .post('/unavailability?clinicId=1')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ doctorId: 5, startDate: '2026-09-20', endDate: '2026-09-21' })
    expect(write.status).toBe(403)

    query.mockResolvedValueOnce({
      rows: [{ doctor_id: 5, clinic_id: 1, start_date: '2026-09-07', end_date: '2026-09-11' }],
    })
    const patch = await request(build())
      .patch('/unavailability/1')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({})
    expect(patch.status).toBe(403)
  })

  it('unauthenticated is 401', async () => {
    const res = await request(build()).get('/unavailability')
    expect(res.status).toBe(401)
  })

  it('doctor lists own via /me (200); admin gets 404 there', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 5 }] })
    query.mockResolvedValueOnce({ rows: [row()] })
    const res = await request(build())
      .get('/unavailability/me')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.data.unavailability[0].doctorId).toBe(5)

    query.mockReset()
    query.mockResolvedValue({ rows: [] })
    const adminRes = await request(build())
      .get('/unavailability/me')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(adminRes.status).toBe(404)
  })

  it('admin creates for a doctor (201); overlap is 409; unknown doctor 404; inverted range 400', async () => {
    let n = 0
    query.mockImplementation(async () => {
      n++
      if (n === 1) return { rows: [{ id: 1 }] }
      if (n === 2) return { rows: [] }
      if (n === 3) return { rows: [{ id: 9 }] }
      return { rows: [row()] }
    })
    const res = await request(build())
      .post('/unavailability')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ doctorId: 5, startDate: '2026-09-20', endDate: '2026-09-21' })
    expect(res.status).toBe(201)
    expect(res.body.data.unavailability).toBeDefined()

    query.mockReset()
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    query.mockResolvedValueOnce({ rows: [{ id: 2 }] })
    const overlapRes = await request(build())
      .post('/unavailability')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ doctorId: 5, startDate: '2026-09-08', endDate: '2026-09-09' })
    expect(overlapRes.status).toBe(409)

    query.mockReset()
    query.mockResolvedValueOnce({ rows: [] })
    const notFoundRes = await request(build())
      .post('/unavailability')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ doctorId: 999, startDate: '2026-09-01', endDate: '2026-09-01' })
    expect(notFoundRes.status).toBe(404)

    const invertedRes = await request(build())
      .post('/unavailability')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ doctorId: 5, startDate: '2026-09-03', endDate: '2026-09-01' })
    expect(invertedRes.status).toBe(400)
  })

  it('doctor creates own via /me (201)', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 5 }] })
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [{ id: 9 }] })
    query.mockResolvedValueOnce({ rows: [row()] })
    const res = await request(build())
      .post('/unavailability/me')
      .set('Authorization', `Bearer ${doctorToken()}`)
      .send({ startDate: '2026-09-01', endDate: '2026-09-02' })
    expect(res.status).toBe(201)
  })

  it('PATCH cross-doctor is 403; non-numeric id is 400', async () => {
    query.mockResolvedValueOnce({
      rows: [{ doctor_id: 5, start_date: '2026-09-07', end_date: '2026-09-11' }],
    })
    query.mockResolvedValueOnce({ rows: [{ id: 8 }] })
    const res = await request(build())
      .patch('/unavailability/1')
      .set('Authorization', `Bearer ${doctorToken()}`)
      .send({})
    expect(res.status).toBe(403)

    const badId = await request(build())
      .patch('/unavailability/abc')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({})
    expect(badId.status).toBe(400)
  })

  it('superadmin can PATCH any record without a doctor profile (200)', async () => {
    const stored = { doctor_id: 5, start_date: '2026-09-07', end_date: '2026-09-11' }
    query.mockResolvedValueOnce({ rows: [stored] })
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] }) // doctors lock
    query.mockResolvedValueOnce({ rows: [stored] }) // locked re-read
    query.mockResolvedValueOnce({ rows: [] }) // overlap check (endDate changed)
    query.mockResolvedValueOnce({ rows: [] }) // UPDATE
    query.mockResolvedValueOnce({ rows: [row()] })
    const res = await request(build())
      .patch('/unavailability/1')
      .set('Authorization', `Bearer ${superadminToken()}`)
      .send({ endDate: '2026-09-12' })
    expect(res.status).toBe(200)
    expect(res.body.data.unavailability).toBeDefined()
  })
})
