import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({ query: (...a: unknown[]) => query(...a) }))

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
    is_active: true,
    created_at: new Date('2026-01-01'),
    ...overrides,
  }
}

beforeEach(() => query.mockReset())

describe('RBAC on /users', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/users')
    expect(res.status).toBe(401)
  })

  it('returns 403 for a doctor', async () => {
    const token = signAccessToken({ sub: 1, role: 'doctor' })
    const res = await request(app).get('/users').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })

  it('returns 200 list for an administrator', async () => {
    query.mockResolvedValue({ rows: [row()] })
    const token = signAccessToken({ sub: 2, role: 'administrator' })
    const res = await request(app).get('/users').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.users).toHaveLength(1)
  })

  it('hides a superadmin from GET /users/:id for an administrator', async () => {
    query.mockResolvedValueOnce({ rows: [row({ id: 3, role: 'superadmin' })] })
    const token = signAccessToken({ sub: 2, role: 'administrator' })
    const res = await request(app).get('/users/3').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })
})

describe('POST /users (admin)', () => {
  it('returns 201 and creates a user', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [row({ id: 5, email: 'new@h.com' })] })
    const token = signAccessToken({ sub: 2, role: 'administrator' })
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'new@h.com', username: 'newdr', password: 'secret1', role: 'doctor', firstName: 'Jane', lastName: 'Roe' })
    expect(res.status).toBe(201)
    expect(res.body.data.user.email).toBe('new@h.com')
  })

  it('returns 409 on duplicate email', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 9 }] })
    const token = signAccessToken({ sub: 2, role: 'administrator' })
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'd@h.com', username: 'newdr', password: 'secret1', role: 'doctor', firstName: 'Jane', lastName: 'Roe' })
    expect(res.status).toBe(409)
  })
})

describe('DELETE /users/:id (admin)', () => {
  it('returns 204 on success, 404 when missing', async () => {
    const token = signAccessToken({ sub: 2, role: 'administrator' })
    query.mockResolvedValueOnce({ rows: [row()] })
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    const ok = await request(app).delete('/users/1').set('Authorization', `Bearer ${token}`)
    expect(ok.status).toBe(204)

    query.mockResolvedValueOnce({ rows: [] })
    const notFound = await request(app).delete('/users/99').set('Authorization', `Bearer ${token}`)
    expect(notFound.status).toBe(404)
  })
})
