import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({ query: (...a: unknown[]) => query(...a) }))

vi.mock('../lib/jwt', () => ({ signAccessToken: vi.fn(() => 'ACCESS') }))

vi.mock('../services/token.service', () => ({
  issueRefreshToken: vi.fn(async () => 'REFRESH'),
  rotateRefreshToken: vi.fn(async () => ({ token: 'REFRESH2', userId: 1 })),
  revokeRefreshToken: vi.fn(async () => undefined),
  revokeAllForUser: vi.fn(async () => undefined),
}))

const { compare, hash } = vi.hoisted(() => ({
  compare: vi.fn(async () => true),
  hash: vi.fn(async () => 'NEWHASH'),
}))
vi.mock('bcrypt', () => ({ default: { compare, hash } }))

import bcrypt from 'bcrypt'
import { changePassword, getUser, login, logout, refresh } from '../services/auth.service'

const SEED_HASH = '$2b$12$6ufrbl6wF.cRx1QOTSCMmeaNFAew0mYaNFYUDanmm50HhdhHXRvJi'

function userRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    email: 'admin@oncall.local',
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
})

describe('auth.service', () => {
  it('login returns tokens on valid credentials', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    const r = await login({ email: 'admin@oncall.local', password: 'changeme123' })
    expect(r.accessToken).toBe('ACCESS')
    expect(r.refreshToken).toBe('REFRESH')
    expect(r.user.email).toBe('admin@oncall.local')
    expect(bcrypt.compare).toHaveBeenCalledWith('changeme123', SEED_HASH)
  })

  it('login throws 401 when user not found', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(login({ email: 'x@y.z', password: 'whatever' })).rejects.toMatchObject({
      status: 401,
    })
  })

  it('login throws 401 on wrong password', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    compare.mockResolvedValue(false)
    await expect(login({ email: 'admin@oncall.local', password: 'bad' })).rejects.toMatchObject({
      status: 401,
    })
  })

  it('login throws 403 when inactive', async () => {
    query.mockResolvedValue({ rows: [userRow({ is_active: false })] })
    await expect(login({ email: 'admin@oncall.local', password: 'changeme123' })).rejects.toMatchObject({
      status: 403,
    })
  })

  it('refresh returns a new access token from the rotated token', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    const r = await refresh('old')
    expect(r.accessToken).toBe('ACCESS')
    expect(r.refreshToken).toBe('REFRESH2')
  })

  it('logout revokes the token', async () => {
    await logout('t')
    expect(query).not.toHaveBeenCalled()
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
  })

  it('changePassword throws 401 on wrong current password', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    compare.mockResolvedValue(false)
    await expect(
      changePassword(1, { currentPassword: 'wrong', newPassword: 'newpass123' }),
    ).rejects.toMatchObject({ status: 401 })
  })
})
