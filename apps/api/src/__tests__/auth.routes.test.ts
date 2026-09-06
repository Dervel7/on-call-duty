import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

const logActivity = vi.fn()
const recordActivity = vi.fn()
vi.mock('../services/activity.service', () => ({
  logActivity: (...a: unknown[]) => logActivity(...a),
  recordActivity: (...a: unknown[]) => recordActivity(...a),
}))

import bcrypt from 'bcrypt'
import request from 'supertest'
import { SYSTEM_LOCKED_MESSAGE } from '@oncall/shared'
import cookieParser from 'cookie-parser'
import express from 'express'
import { authRouter } from '../routes/auth.routes'
import { errorHandler } from '../middleware/error-handler'

const SEED_HASH = '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use('/auth', authRouter)
  app.use(errorHandler)
  return app
}

function userRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    email: 'admin@oncall.local',
    username: 'admin',
    password_hash: SEED_HASH,
    role: 'administrator',
    first_name: 'System',
    last_name: 'Administrator',
    is_active: true,
    created_at: new Date('2026-01-01'),
    ...overrides,
  }
}

beforeEach(() => query.mockReset())

describe('POST /auth/login', () => {
  it('returns 200, access token + Set-Cookie on success', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    const res = await request(buildApp())
      .post('/auth/login')
      .send({ identifier: 'admin@oncall.local', password: 'changeme123' })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.accessToken).toBeTruthy()
    expect(res.body.data.user.email).toBe('admin@oncall.local')
    const setCookie = res.headers['set-cookie']?.[0] ?? ''
    expect(setCookie).toContain('refresh_token=')
    expect(setCookie.toLowerCase()).toContain('httponly')
  })

  it('returns 400 on invalid body', async () => {
    const res = await request(buildApp()).post('/auth/login').send({ identifier: '', password: '1' })
    expect(res.status).toBe(400)
  })

  it('returns 401 on wrong password (real bcrypt compare)', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    const res = await request(buildApp())
      .post('/auth/login')
      .send({ identifier: 'admin@oncall.local', password: 'wrongpass' })
    expect(res.status).toBe(401)
  })
})

describe('GET /auth/me', () => {
  it('returns 401 without a bearer token', async () => {
    const res = await request(buildApp()).get('/auth/me')
    expect(res.status).toBe(401)
  })
})

describe('bcrypt sanity', () => {
  it('the seed hash matches changeme123 at cost 12', async () => {
    await expect(bcrypt.compare('changeme123', SEED_HASH)).resolves.toBe(true)
  })
})

describe('billing lockdown', () => {
  // Rows served to billingService.isLocked; [] restores the missing app_meta
  // row (unlocked) so no deadline leaks into other tests.
  let lockRows: Array<Record<string, unknown>>

  // Routes every SQL the auth flow issues: user/token reads, rotation writes,
  // and the app_meta lock check.
  function installDb(userOverrides: Partial<Record<string, unknown>> = {}) {
    query.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? '')
      if (sql.includes('app_meta')) return { rows: lockRows }
      if (sql.includes('FROM refresh_tokens WHERE token_hash')) {
        return {
          rows: [
            {
              id: 1,
              user_id: 1,
              expires_at: new Date(Date.now() + 3600_000),
              revoked_at: null,
              replaced_by: null,
            },
          ],
        }
      }
      if (sql.includes('INSERT INTO refresh_tokens')) return { rows: [{ id: 2 }] }
      if (sql.includes('replaced_by')) return { rows: [{ id: 1 }] }
      return { rows: [userRow(userOverrides)] }
    })
  }

  beforeEach(() => {
    lockRows = [{ locked: true }]
  })
  afterEach(() => {
    lockRows = []
  })

  it('locked: doctor login is 403 with SYSTEM_LOCKED_MESSAGE', async () => {
    installDb({ role: 'doctor' })
    const res = await request(buildApp())
      .post('/auth/login')
      .send({ identifier: 'dr1@oncall.local', password: 'changeme123' })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe(SYSTEM_LOCKED_MESSAGE)
  })

  it('locked: doctor refresh is 403 with SYSTEM_LOCKED_MESSAGE', async () => {
    installDb({ role: 'doctor' })
    const res = await request(buildApp()).post('/auth/refresh').set('Cookie', 'refresh_token=t')
    expect(res.status).toBe(403)
    expect(res.body.error).toBe(SYSTEM_LOCKED_MESSAGE)
  })

  it('locked: superadmin login still succeeds (200)', async () => {
    installDb({ role: 'superadmin' })
    const res = await request(buildApp())
      .post('/auth/login')
      .send({ identifier: 'superadmin@oncall.local', password: 'changeme123' })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})
