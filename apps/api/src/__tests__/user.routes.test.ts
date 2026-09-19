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

import request from 'supertest'
import { app } from '../app'
import { signAccessToken } from '../lib/jwt'

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    email: 'd@h.com',
    username: 'dr1',
    password_hash: 'x',
    role: 'doctor',
    first_name: 'Jane',
    last_name: 'Roe',
    dark_mode: false,
    clinic_id: 1,
    clinic_name: 'Radiology',
    created_at: new Date('2026-01-01'),
    ...overrides,
  }
}

// Route the service's queries: clinic usability, dup checks, business writes.
function installDb(rows: Record<string, unknown>[] = [row()]) {
  query.mockImplementation(async (...args: unknown[]) => {
    const sql = String(args[0] ?? '')
    if (sql.includes('FROM clinics')) return { rows: [{ is_active: true }] }
    if (sql.includes('WHERE email =')) return { rows: [] }
    if (sql.includes('WHERE username =')) return { rows: [] }
    return { rows }
  })
}

beforeEach(() => query.mockReset())

describe('RBAC on /users', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/users')
    expect(res.status).toBe(401)
  })

  it('returns 403 for a doctor', async () => {
    const token = signAccessToken({ sub: 1, role: 'doctor', clinicId: 10 })
    const res = await request(app).get('/users').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })

  it('returns 200 list for an administrator', async () => {
    query.mockResolvedValue({ rows: [row()] })
    const token = signAccessToken({ sub: 2, role: 'administrator', clinicId: 1 })
    const res = await request(app).get('/users').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.users).toHaveLength(1)
  })

  it('administrator cannot list another clinic (I1: 403)', async () => {
    const token = signAccessToken({ sub: 2, role: 'administrator', clinicId: 1 })
    const res = await request(app).get('/users?clinicId=2').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })

  it('manager must name a clinic (400 without clinicId)', async () => {
    const token = signAccessToken({ sub: 5, role: 'manager', clinicId: null })
    const res = await request(app).get('/users').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
  })

  it('manager lists a clinic with clinicId (200)', async () => {
    query.mockResolvedValue({ rows: [row()] })
    const token = signAccessToken({ sub: 5, role: 'manager', clinicId: null })
    const res = await request(app).get('/users?clinicId=1').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(query.mock.calls[0]?.[1]).toEqual([1])
  })

  it('hides a superadmin from GET /users/:id for an administrator', async () => {
    query.mockResolvedValueOnce({ rows: [row({ id: 3, role: 'superadmin', clinic_id: null })] })
    const token = signAccessToken({ sub: 2, role: 'administrator', clinicId: 1 })
    const res = await request(app).get('/users/3').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })

  it('administrator cannot read another clinic user (I2: 404)', async () => {
    query.mockResolvedValueOnce({ rows: [row({ id: 7, clinic_id: 2 })] })
    const token = signAccessToken({ sub: 2, role: 'administrator', clinicId: 1 })
    const res = await request(app).get('/users/7').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })
})

describe('POST /users (admin)', () => {
  it('returns 201 and creates a user in the actor clinic', async () => {
    installDb([row({ id: 5, email: 'new@h.com' })])
    const token = signAccessToken({ sub: 2, role: 'administrator', clinicId: 1 })
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'new@h.com', username: 'newdr', password: 'secret1', role: 'doctor', firstName: 'Jane', lastName: 'Roe' })
    expect(res.status).toBe(201)
    expect(res.body.data.user.email).toBe('new@h.com')
    const insert = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO users'))
    expect(insert?.[1]?.[6]).toBe(1)
  })

  it('returns 409 on duplicate email', async () => {
    query.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? '')
      if (sql.includes('FROM clinics')) return { rows: [{ is_active: true }] }
      if (sql.includes('WHERE email =')) return { rows: [{ id: 9 }] }
      return { rows: [] }
    })
    const token = signAccessToken({ sub: 2, role: 'administrator', clinicId: 1 })
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'd@h.com', username: 'newdr', password: 'secret1', role: 'doctor', firstName: 'Jane', lastName: 'Roe' })
    expect(res.status).toBe(409)
  })
})

describe('DELETE /users/:id (admin)', () => {
  it('returns 204 on success, 404 when missing or cross-clinic (I24)', async () => {
    const token = signAccessToken({ sub: 2, role: 'administrator', clinicId: 1 })
    query.mockResolvedValueOnce({ rows: [row()] })
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    const ok = await request(app).delete('/users/1').set('Authorization', `Bearer ${token}`)
    expect(ok.status).toBe(204)

    query.mockResolvedValueOnce({ rows: [row({ clinic_id: 2 })] })
    const cross = await request(app).delete('/users/1').set('Authorization', `Bearer ${token}`)
    expect(cross.status).toBe(404)

    query.mockResolvedValueOnce({ rows: [] })
    const notFound = await request(app).delete('/users/99').set('Authorization', `Bearer ${token}`)
    expect(notFound.status).toBe(404)
  })
})

describe('PATCH /users/me/theme (self-service)', () => {
  it('lets any authenticated role set their own preference', async () => {
    query.mockResolvedValueOnce({ rows: [row({ dark_mode: true })] })
    const token = signAccessToken({ sub: 1, role: 'doctor', clinicId: 10 })
    const res = await request(app)
      .patch('/users/me/theme')
      .set('Authorization', `Bearer ${token}`)
      .send({ darkMode: true })
    expect(res.status).toBe(200)
    expect(res.body.data.user.darkMode).toBe(true)
    expect(query.mock.calls[0]?.[1]).toEqual([true, 1])
  })

  it('returns 401 without auth', async () => {
    const res = await request(app).patch('/users/me/theme').send({ darkMode: true })
    expect(res.status).toBe(401)
  })

  it('returns 400 on a non-boolean body', async () => {
    const token = signAccessToken({ sub: 1, role: 'doctor', clinicId: 10 })
    const res = await request(app)
      .patch('/users/me/theme')
      .set('Authorization', `Bearer ${token}`)
      .send({ darkMode: 'yes' })
    expect(res.status).toBe(400)
  })
})
