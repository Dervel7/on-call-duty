import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({ query: (...a: unknown[]) => query(...a) }))

const logActivity = vi.fn()
const recordActivity = vi.fn()
vi.mock('../services/activity.service', () => ({
  logActivity: (...a: unknown[]) => logActivity(...a),
  recordActivity: (...a: unknown[]) => recordActivity(...a),
}))

vi.mock('../lib/jwt', () => ({ signAccessToken: vi.fn(() => 'ACCESS') }))

vi.mock('../services/token.service', () => ({
  issueRefreshToken: vi.fn(async () => 'REFRESH'),
  rotateRefreshToken: vi.fn(async () => ({ token: 'REFRESH2', userId: 1 })),
  revokeRefreshToken: vi.fn(async () => null),
  revokeAllForUser: vi.fn(async () => undefined),
}))

const { compare, hash } = vi.hoisted(() => ({
  compare: vi.fn(async () => true),
  hash: vi.fn(async () => 'NEWHASH'),
}))
vi.mock('bcrypt', () => ({ default: { compare, hash } }))

import bcrypt from 'bcrypt'
import * as tokenService from '../services/token.service'
import { changePassword, getUser, login, logout, refresh } from '../services/auth.service'

const SEED_HASH = '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi'

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

beforeEach(() => {
  query.mockReset()
  compare.mockReset()
  hash.mockReset()
  compare.mockResolvedValue(true)
  hash.mockResolvedValue('NEWHASH')
  logActivity.mockReset()
  recordActivity.mockReset()
})

describe('auth.service', () => {
  it('login returns tokens on valid credentials (by email)', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    const r = await login({ identifier: 'admin@oncall.local', password: 'changeme123' })
    expect(r.accessToken).toBe('ACCESS')
    expect(r.refreshToken).toBe('REFRESH')
    expect(r.user.email).toBe('admin@oncall.local')
    expect(r.user.username).toBe('admin')
    expect(bcrypt.compare).toHaveBeenCalledWith('changeme123', SEED_HASH)
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login', userId: 1 }),
    )
  })

  it('login by username resolves via the username lookup', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    const r = await login({ identifier: 'admin', password: 'changeme123' })
    expect(r.accessToken).toBe('ACCESS')
    expect(r.user.username).toBe('admin')
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('WHERE username = $1')
    expect(query.mock.calls[0]?.[1]).toEqual(['admin'])
  })

  it('login throws 401 when user not found', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(login({ identifier: 'x@y.z', password: 'whatever' })).rejects.toMatchObject({
      status: 401,
    })
  })

  it('login throws 401 on wrong password', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    compare.mockResolvedValue(false)
    await expect(login({ identifier: 'admin@oncall.local', password: 'bad' })).rejects.toMatchObject({
      status: 401,
    })
  })

  it('login throws 403 when inactive', async () => {
    query.mockResolvedValue({ rows: [userRow({ is_active: false })] })
    await expect(
      login({ identifier: 'admin@oncall.local', password: 'changeme123' }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('login throws 401 when the account is deleted (invisible)', async () => {
    query.mockResolvedValue({ rows: [] }) // lookups filter is_deleted = FALSE
    await expect(
      login({ identifier: 'gone@h.com', password: 'whatever' }),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('refresh returns a new access token from the rotated token', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    const r = await refresh('old')
    expect(r.accessToken).toBe('ACCESS')
    expect(r.refreshToken).toBe('REFRESH2')
  })

  it('refresh throws 401 when the account is deleted (filtered out)', async () => {
    query.mockResolvedValue({ rows: [] }) // findUserById filters is_deleted = FALSE
    await expect(refresh('old')).rejects.toMatchObject({ status: 401 })
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('is_deleted = FALSE')
  })

  it('logout revokes the token and logs the audit event', async () => {
    vi.mocked(tokenService.revokeRefreshToken).mockResolvedValue(7)
    await logout('t')
    expect(tokenService.revokeRefreshToken).toHaveBeenCalledWith('t')
    expect(query).not.toHaveBeenCalled()
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.logout', userId: 7 }),
    )
  })

  it('getUser throws 404 when missing', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(getUser(99)).rejects.toMatchObject({ status: 404 })
  })

  it('changePassword re-hashes and revokes all tokens', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    const u = await changePassword(1, { currentPassword: 'changeme123', newPassword: 'newpass123' })
    expect(u.id).toBe(1)
    expect(hash).toHaveBeenCalledWith('newpass123', 12)
    const updateSql = query.mock.calls.find((c) => String(c[0]).includes('UPDATE users'))
    expect(updateSql?.[1]).toEqual(['NEWHASH', 1])
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.password_changed', userId: 1 }),
    )
  })

  it('changePassword throws 401 on wrong current password', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    compare.mockResolvedValue(false)
    await expect(
      changePassword(1, { currentPassword: 'wrong', newPassword: 'newpass123' }),
    ).rejects.toMatchObject({ status: 401 })
  })
})
