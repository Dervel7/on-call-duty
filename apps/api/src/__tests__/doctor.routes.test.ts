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

const adminToken = () => signAccessToken({ sub: 1, role: 'administrator', clinicId: 1 })
const doctorToken = () => signAccessToken({ sub: 10, role: 'doctor', clinicId: 10 })
const managerToken = () => signAccessToken({ sub: 5, role: 'manager', clinicId: null })
const superadminToken = () => signAccessToken({ sub: 2, role: 'superadmin', clinicId: null })

const row = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  user_id: 10,
  email: 'd@h.com',
  username: 'dr1',
  first_name: 'Jane',
  last_name: 'Roe',
  is_active: true,
  max_monthly_duties: 7,
  clinic_id: 1,
  clinic_name: 'Radiology',
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
})

function installDb(rows: Record<string, unknown>[] = [row()]) {
  query.mockImplementation(async (...args: unknown[]) => {
    const sql = String(args[0] ?? '')
    if (sql.includes('WHERE email =')) return { rows: [] }
    if (sql.includes('WHERE username =')) return { rows: [] }
    if (sql.includes('INSERT INTO users')) return { rows: [{ id: 10 }] }
    if (sql.includes('INSERT INTO doctors')) return { rows: [{ id: 1 }] }
    return { rows }
  })
}

beforeEach(() => query.mockReset())

describe('doctor routes', () => {
  it('admin lists doctors (200, envelope)', async () => {
    query.mockResolvedValue({ rows: [row()] })
    const res = await request(build())
      .get('/doctors')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.doctors).toHaveLength(1)
    expect(query.mock.calls[0]?.[1]).toEqual([1])
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

  it('manager reads with clinicId (200), 400 without, 403 on write (I14)', async () => {
    query.mockResolvedValue({ rows: [row()] })
    const okRes = await request(build())
      .get('/doctors?clinicId=1')
      .set('Authorization', `Bearer ${managerToken()}`)
    expect(okRes.status).toBe(200)
    expect(okRes.body.data.doctors).toHaveLength(1)

    const missing = await request(build()).get('/doctors').set('Authorization', `Bearer ${managerToken()}`)
    expect(missing.status).toBe(400)

    const write = await request(build())
      .post('/doctors?clinicId=1')
      .set('Authorization', `Bearer ${managerToken()}`)
      .send({ email: 'n@h.com', username: 'ndr', password: 'secret1', firstName: 'N', lastName: 'D' })
    expect(write.status).toBe(403)
  })

  it('superadmin create without clinicId is 400 (I25)', async () => {
    const res = await request(build())
      .post('/doctors')
      .set('Authorization', `Bearer ${superadminToken()}`)
      .send({ email: 'n@h.com', username: 'ndr', password: 'secret1', firstName: 'N', lastName: 'D' })
    expect(res.status).toBe(400)
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

  it('admin cannot read a cross-clinic doctor (404)', async () => {
    query.mockResolvedValueOnce({ rows: [row({ clinic_id: 2 })] })
    const res = await request(build())
      .get('/doctors/1')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(404)
  })

  it('admin creates a doctor in the own clinic (201)', async () => {
    installDb()
    const res = await request(build())
      .post('/doctors')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ email: 'new@h.com', username: 'newdr', password: 'secret1', firstName: 'Jane', lastName: 'Roe' })
    expect(res.status).toBe(201)
    expect(res.body.data.doctor.clinicId).toBe(1)
    const insertUser = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO users'))
    expect(insertUser?.[1]?.[5]).toBe(1)
    const insertDoctor = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO doctors'))
    expect(insertDoctor?.[1]?.[1]).toBe(1)
  })

  it('admin create with out-of-range maxMonthlyDuties is 400', async () => {
    const res = await request(build())
      .post('/doctors')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ email: 'new@h.com', username: 'newdr', password: 'secret1', firstName: 'Jane', lastName: 'Roe', maxMonthlyDuties: 9 })
    expect(res.status).toBe(400)
  })

  it('admin DELETE /doctors/:id soft-deletes (204, rows kept)', async () => {
    query.mockResolvedValueOnce({ rows: [row()] })
    query.mockResolvedValueOnce({ rows: [] }) // draft-duty check
    query.mockResolvedValueOnce({ rows: [] }) // UPDATE users
    const res = await request(build())
      .delete('/doctors/1')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(204)
    const upd = query.mock.calls[2]?.[0] as string
    expect(upd).toContain('UPDATE users')
    expect(upd).toContain('is_deleted = TRUE')
    expect(query.mock.calls.some((c) => String(c[0]).includes('DELETE FROM users'))).toBe(false)
  })

  it('admin PATCH /doctors/:id { isActive: true } reactivates (200)', async () => {
    query
      .mockResolvedValueOnce({ rows: [row({ is_active: false })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row({ is_active: true })] })
    const res = await request(build())
      .patch('/doctors/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ isActive: true })
    expect(res.status).toBe(200)
    expect(res.body.data.doctor.isActive).toBe(true)
  })
})
