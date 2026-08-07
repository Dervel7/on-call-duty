import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))
vi.mock('bcrypt', () => ({
  default: { hash: vi.fn(async () => 'HASH'), compare: vi.fn(async () => true) },
}))

import { signAccessToken } from '../lib/jwt'
import { errorHandler } from '../middleware/error-handler'
import { doctorRouter } from '../routes/doctor.routes'

function build() {
  const app = express()
  app.use(express.json())
  app.use('/doctors', doctorRouter)
  app.use(errorHandler)
  return app
}

const adminToken = () => signAccessToken({ sub: 1, role: 'administrator' })
const doctorToken = () => signAccessToken({ sub: 10, role: 'doctor' })

const row = () => ({
  id: 1,
  user_id: 10,
  email: 'd@h.com',
  username: 'dr1',
  first_name: 'Jane',
  last_name: 'Roe',
  is_active: true,
  max_monthly_duties: 7,
  created_at: new Date(),
  updated_at: new Date(),
})

beforeEach(() => query.mockReset())

describe('doctor routes', () => {
  it('admin lists doctors (200, envelope)', async () => {
    query.mockResolvedValue({ rows: [] })
    const res = await request(build())
      .get('/doctors')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.doctors).toEqual([])
  })

  it('unauthenticated is 401', async () => {
    const res = await request(build()).get('/doctors')
    expect(res.status).toBe(401)
  })

  it('doctor is forbidden from the admin list (403)', async () => {
    const res = await request(build())
      .get('/doctors')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(res.status).toBe(403)
  })

  it('doctor reads own profile via /doctors/me (200)', async () => {
    query.mockResolvedValue({ rows: [row()] })
    const res = await request(build())
      .get('/doctors/me')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.data.doctor.userId).toBe(10)
  })

  it('non-numeric :id is 400', async () => {
    const res = await request(build())
      .get('/doctors/abc')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(400)
  })

  it('admin creates a doctor (201)', async () => {
    let n = 0
    query.mockImplementation(async () => {
      n++
      if (n === 1) return { rows: [] }
      if (n === 2) return { rows: [] }
      if (n === 3) return { rows: [{ id: 12 }] }
      if (n === 4) return { rows: [] }
      return { rows: [row()] }
    })
    const res = await request(build())
      .post('/doctors')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ email: 'new@h.com', username: 'newdr', password: 'secret1', firstName: 'Jane', lastName: 'Roe' })
    expect(res.status).toBe(201)
    expect(res.body.data.doctor).toBeDefined()
  })

  it('admin create with out-of-range maxMonthlyDuties is 400', async () => {
    const res = await request(build())
      .post('/doctors')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ email: 'new@h.com', username: 'newdr', password: 'secret1', firstName: 'Jane', lastName: 'Roe', maxMonthlyDuties: 9 })
    expect(res.status).toBe(400)
  })
})
