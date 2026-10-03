import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as EnvModule from '../config/env'

// rateLimit is a no-op under NODE_ENV=test; run these routes as in development.
vi.mock('../config/env', async (importOriginal) => {
  const original = await importOriginal<typeof EnvModule>()
  return { env: { ...original.env, NODE_ENV: 'development' } }
})

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

vi.mock('../services/activity.service', () => ({
  logActivity: vi.fn(),
  recordActivity: vi.fn(),
}))

// Real bcrypt at cost 12 would make 100+ attempts slow; every attempt fails.
vi.mock('bcrypt', () => ({ default: { compare: vi.fn(async () => false), hash: vi.fn() } }))

import cookieParser from 'cookie-parser'
import express from 'express'
import request from 'supertest'
import { signAccessToken } from '../lib/jwt'
import { errorHandler } from '../middleware/error-handler'
import { authRouter } from '../routes/auth.routes'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use('/auth', authRouter)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  query.mockReset()
})

describe('auth rate limits', () => {
  it('caps login attempts per IP even when every attempt uses a different identifier', async () => {
    query.mockResolvedValue({ rows: [] }) // unknown accounts → 401
    const app = buildApp()
    const statuses: number[] = []
    for (let i = 0; i < 101; i++) {
      const res = await request(app)
        .post('/auth/login')
        .send({ identifier: `user${i}@h.com`, password: 'guess123' })
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 100).every((s) => s === 401)).toBe(true)
    expect(statuses[100]).toBe(429)
  })

  it('caps change-password attempts per account', async () => {
    query.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? '')
      if (sql.includes('app_meta')) return { rows: [] } // not locked
      return {
        rows: [
          {
            id: 5,
            email: 'dr@h.com',
            username: 'dr',
            password_hash: 'x',
            role: 'doctor',
            first_name: 'D',
            last_name: 'R',
            is_active: true,
            dark_mode: false,
            language: 'en',
            clinic_id: 1,
            clinic_name: 'Main',
            clinic_is_active: true,
            created_at: new Date('2026-01-01'),
          },
        ],
      }
    })
    const token = signAccessToken({ sub: 5, role: 'doctor', clinicId: 1 })
    const app = buildApp()
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      const res = await request(app)
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: `guess${i}xx`, newPassword: 'newpass123' })
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true)
    expect(statuses[10]).toBe(429)
  })

  it('lets a shared hospital address refresh far more often than it may log in', async () => {
    // Every signed-in user behind the NAT refreshes once per access-token lifetime
    // and once per page load; a 429 here signs them out.
    const app = buildApp()
    const statuses: number[] = []
    for (let i = 0; i < 601; i++) {
      const res = await request(app).post('/auth/refresh')
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 600).every((s) => s === 401)).toBe(true)
    expect(statuses[600]).toBe(429)
  })
})
