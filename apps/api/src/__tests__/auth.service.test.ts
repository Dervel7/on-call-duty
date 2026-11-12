import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
const txQuery = vi.fn()
vi.mock('../db/client.ts', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof txQuery }) => Promise<unknown>) => work({ query: txQuery }),
}))

const logActivity = vi.fn()
const recordActivity = vi.fn()
vi.mock('../services/activity.service.ts', () => ({
  logActivity: (...a: unknown[]) => logActivity(...a),
  recordActivity: (...a: unknown[]) => recordActivity(...a),
}))

vi.mock('../lib/jwt.ts', () => ({ signAccessToken: vi.fn(() => 'ACCESS') }))

vi.mock('../services/token.service.ts', () => ({
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
import { signAccessToken } from '../lib/jwt.ts'
import * as tokenService from '../services/token.service.ts'
import { changePassword, getUser, login, logout, refresh } from '../services/auth.service.ts'

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
    dark_mode: false,
    language: 'en',
    clinic_id: 1,
    clinic_name: 'Radiology',
    clinic_is_active: true,
    created_at: new Date('2026-01-01'),
    ...overrides,
  }
}

beforeEach(() => {
  query.mockReset()
  txQuery.mockReset()
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
     expect(r.user.username).toBe('admin')
    expect(r.user.darkMode).toBe(false)
    expect(bcrypt.compare).toHaveBeenCalledWith('changeme123', SEED_HASH)
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login', userId: 1, clinicId: 1 }),
    )
  })

  it('login by username resolves via the username lookup', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    const r = await login({ identifier: 'admin', password: 'changeme123' })
    expect(r.accessToken).toBe('ACCESS')
    expect(r.user.username).toBe('admin')
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('WHERE u.username = $1')
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

  it('login throws 403 "Clinic is deactivated" for a deactivated clinic (D10)', async () => {
    query.mockResolvedValue({ rows: [userRow({ clinic_is_active: false })] })
    await expect(
      login({ identifier: 'admin@oncall.local', password: 'changeme123' }),
    ).rejects.toMatchObject({ status: 403, message: 'Clinic is deactivated' })
  })

  it('login signs the access token with the clinic claim and returns clinic fields', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    const r = await login({ identifier: 'admin@oncall.local', password: 'changeme123' })
    expect(signAccessToken).toHaveBeenCalledWith({ sub: 1, role: 'administrator', clinicId: 1 })
    expect(r.user.clinicId).toBe(1)
    expect(r.user.clinicName).toBe('Radiology')
  })

  it('login of a manager signs clinicId null', async () => {
    query.mockResolvedValue({
      rows: [
        userRow({
          id: 2,
          role: 'manager',
          clinic_id: null,
          clinic_name: null,
          clinic_is_active: null,
        }),
      ],
    })
    const r = await login({ identifier: 'manager', password: 'changeme123' })
    expect(signAccessToken).toHaveBeenCalledWith({ sub: 2, role: 'manager', clinicId: null })
    expect(r.user.clinicId).toBeNull()
  })


  it('login throws 401 when the account is deleted (invisible)', async () => {
    query.mockResolvedValue({ rows: [] }) // lookups filter is_deleted = FALSE
    await expect(
      login({ identifier: 'gone@h.com', password: 'whatever' }),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('refresh throws 403 "Clinic is deactivated" for a user of a deactivated clinic', async () => {
    query.mockResolvedValue({ rows: [userRow({ clinic_is_active: false })] })
    await expect(refresh('old')).rejects.toMatchObject({ status: 403, message: 'Clinic is deactivated' })
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

  it('logout revokes the token and logs the audit event with the user clinic', async () => {
    vi.mocked(tokenService.revokeRefreshToken).mockResolvedValue(7)
    query.mockResolvedValue({ rows: [userRow({ id: 7, clinic_id: 3 })] })
    await logout('t')
    expect(tokenService.revokeRefreshToken).toHaveBeenCalledWith('t')
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.logout', userId: 7, clinicId: 3 }),
    )
  })

  it('logout still logs the event with a null clinic when the user no longer exists', async () => {
    vi.mocked(tokenService.revokeRefreshToken).mockResolvedValue(7)
    query.mockResolvedValue({ rows: [] })
    await logout('t')
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.logout', userId: 7, clinicId: null }),
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
    const updateSql = txQuery.mock.calls.find((c) => String(c[0]).includes('UPDATE users'))
    expect(updateSql?.[1]).toEqual(['NEWHASH', 1])
    expect(tokenService.revokeAllForUser).toHaveBeenCalledWith(1, { query: txQuery })
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.password_changed', userId: 1, clinicId: 1 }),
    )
  })

  it('changePassword throws 400 on wrong current password (401 is reserved for missing auth)', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    compare.mockResolvedValue(false)
    await expect(
      changePassword(1, { currentPassword: 'wrong', newPassword: 'newpass123' }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('auth.service changePassword failure', () => {
  it('rejects when the session revoke fails, after the update ran on the transaction client', async () => {
    query.mockResolvedValue({ rows: [userRow()] })
    vi.mocked(tokenService.revokeAllForUser).mockRejectedValueOnce(new Error('db down'))
    await expect(
      changePassword(1, { currentPassword: 'changeme123', newPassword: 'newpass123' }),
    ).rejects.toThrow('db down')
    expect(txQuery.mock.calls.some((c) => String(c[0]).includes('UPDATE users'))).toBe(true)
    expect(logActivity).not.toHaveBeenCalled()
  })
})
