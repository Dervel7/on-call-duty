import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const { hash } = vi.hoisted(() => ({ hash: vi.fn(async () => 'HASH') }))
vi.mock('bcrypt', () => ({ default: { hash } }))

import { create, getById, list, remove, update } from '../services/user.service'

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    email: 'd@h.com',
    username: 'dr1',
    password_hash: 'HASH',
    role: 'doctor',
    first_name: 'Jane',
    last_name: 'Roe',
    is_active: true,
    created_at: new Date('2026-01-01'),
    ...overrides,
  }
}

beforeEach(() => {
  query.mockReset()
  hash.mockReset()
  hash.mockResolvedValue('HASH')
  logActivity.mockReset()
  recordActivity.mockReset()
})

describe('user.service', () => {
  const adminActor = { id: 2, role: 'administrator' as const }
  const superadminActor = { id: 3, role: 'superadmin' as const }

  it('list maps rows to User', async () => {
    query.mockResolvedValue({ rows: [row(), row({ id: 2, email: 'x@y.z' })] })
    const users = await list()
    expect(users).toHaveLength(2)
    expect(users[0]?.firstName).toBe('Jane')
    expect(typeof users[0]?.createdAt).toBe('string')
  })

  it('list filters out superadmins for a non-superadmin actor', async () => {
    query.mockResolvedValue({ rows: [row()] })
    await list(adminActor)
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('role <> $1')
    expect(query.mock.calls[0]?.[1]).toEqual(['superadmin'])
  })

  it('list uses the unfiltered query for a superadmin actor', async () => {
    query.mockResolvedValue({ rows: [row()] })
    await list(superadminActor)
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).not.toContain('role <>')
    expect(query.mock.calls[0]?.[1]).toEqual([])
  })

  it('list uses the unfiltered query when no actor is given', async () => {
    query.mockResolvedValue({ rows: [row()] })
    await list()
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).not.toContain('role <>')
    expect(query.mock.calls[0]?.[1]).toEqual([])
  })

  it('getById of a superadmin row throws 404 for a non-superadmin actor', async () => {
    query.mockResolvedValueOnce({ rows: [row({ role: 'superadmin' })] })
    await expect(getById(1, adminActor)).rejects.toMatchObject({ status: 404 })
  })

  it('getById of a superadmin row resolves for a superadmin actor', async () => {
    query.mockResolvedValueOnce({ rows: [row({ role: 'superadmin' })] })
    const u = await getById(1, superadminActor)
    expect(u.role).toBe('superadmin')
  })

  it('getById without an actor resolves a superadmin row (internal path)', async () => {
    query.mockResolvedValueOnce({ rows: [row({ role: 'superadmin' })] })
    const u = await getById(1)
    expect(u.role).toBe('superadmin')
  })

  it('create rejects duplicate email with 409', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 9 }] })
    await expect(
      create(
        {
          email: 'd@h.com',
          username: 'dr1',
          password: 'secret1',
          role: 'doctor',
          firstName: 'J',
          lastName: 'R',
        },
        adminActor,
      ),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('create rejects duplicate username with 409', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 9 }] })
    await expect(
      create(
        {
          email: 'd@h.com',
          username: 'dr1',
          password: 'secret1',
          role: 'doctor',
          firstName: 'J',
          lastName: 'R',
        },
        adminActor,
      ),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('create hashes the password and inserts', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [row()] })
    const u = await create(
      {
        email: 'd@h.com',
        username: 'dr1',
        password: 'secret1',
        role: 'doctor',
        firstName: 'Jane',
        lastName: 'Roe',
      },
      adminActor,
    )
    expect(hash).toHaveBeenCalledWith('secret1', 12)
    expect(u.email).toBe('d@h.com')
    const insertSql = query.mock.calls[2]?.[0] as string
    expect(insertSql).toContain('INSERT INTO users')
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'user.created', userId: 2, entityId: 1 }),
    )
  })

  it('create rejects superadmin role from a non-superadmin actor with 403', async () => {
    await expect(
      create(
        {
          email: 'sa@oncall.local',
          username: 'sa',
          password: 'secret1',
          role: 'superadmin',
          firstName: 'S',
          lastName: 'A',
        },
        adminActor,
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect(query).not.toHaveBeenCalled()
  })

  it('update builds a partial SET clause', async () => {
    query.mockResolvedValueOnce({ rows: [row()] })
    query.mockResolvedValueOnce({ rows: [row({ is_active: false })] })
    const u = await update(1, { isActive: false }, adminActor)
    expect(u.isActive).toBe(false)
    const sql = query.mock.calls[1]?.[0] as string
    const setClause = sql.split('WHERE')[0] as string
    expect(setClause).toContain('is_active = $1')
    expect(setClause).not.toContain('email')
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'user.deactivated', entityId: 1 }),
    )
  })

  it('update skips the audit row when nothing changed', async () => {
    query.mockResolvedValueOnce({ rows: [row()] })
    query.mockResolvedValueOnce({ rows: [row()] })
    const u = await update(1, { email: 'd@h.com' }, adminActor)
    expect(u.email).toBe('d@h.com')
    expect(recordActivity).not.toHaveBeenCalled()
  })

  it('update records the audit row when a field changes', async () => {
    query.mockResolvedValueOnce({ rows: [row()] })
    query.mockResolvedValueOnce({ rows: [] }) // duplicate-email check
    query.mockResolvedValueOnce({ rows: [row({ email: 'new@h.com' })] })
    const u = await update(1, { email: 'new@h.com' }, adminActor)
    expect(u.email).toBe('new@h.com')
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'user.updated',
        entityId: 1,
        detail: { before: { email: 'd@h.com' }, after: { email: 'new@h.com' } },
      }),
    )
  })

  it('update rejects an email already used by another live account with 409', async () => {
    query.mockResolvedValueOnce({ rows: [row()] })
    query.mockResolvedValueOnce({ rows: [{ id: 9 }] })
    await expect(update(1, { email: 'taken@h.com' }, adminActor)).rejects.toMatchObject({
      status: 409,
      message: 'Email already in use',
    })
  })

  it('update rejects a username already used by another live account with 409', async () => {
    query.mockResolvedValueOnce({ rows: [row()] })
    query.mockResolvedValueOnce({ rows: [{ id: 9 }] })
    await expect(update(1, { username: 'taken' }, adminActor)).rejects.toMatchObject({
      status: 409,
      message: 'Username already in use',
    })
  })

  it('update rejects managing a superadmin account from a non-superadmin actor with 403', async () => {
    query.mockResolvedValueOnce({ rows: [row({ role: 'superadmin' })] })
    await expect(update(1, { isActive: false }, adminActor)).rejects.toMatchObject({ status: 403 })
  })

  it('update rejects promoting a user to superadmin from a non-superadmin actor with 403', async () => {
    query.mockResolvedValueOnce({ rows: [row()] })
    await expect(update(1, { role: 'superadmin' }, adminActor)).rejects.toMatchObject({
      status: 403,
    })
  })

  it('update allows a superadmin actor to manage superadmin accounts', async () => {
    query
      .mockResolvedValueOnce({ rows: [row({ role: 'superadmin' })] })
      .mockResolvedValueOnce({ rows: [row({ role: 'superadmin', is_active: false })] })
    const u = await update(1, { isActive: false }, superadminActor)
    expect(u.isActive).toBe(false)
  })

  it('remove rejects deleting a superadmin from a non-superadmin actor with 403', async () => {
    query.mockResolvedValueOnce({ rows: [row({ role: 'superadmin' })] })
    await expect(remove(1, adminActor)).rejects.toMatchObject({ status: 403 })
  })

  it('remove soft-deletes the user and records the audit row in-transaction', async () => {
    query.mockResolvedValueOnce({ rows: [row()] })
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    await remove(1, adminActor)
    const upd = query.mock.calls[1]?.[0] as string
    expect(upd).toContain('UPDATE users')
    expect(upd).toContain('is_deleted = TRUE')
    expect(query.mock.calls.some((c) => String(c[0]).includes('DELETE FROM users'))).toBe(false)
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'user.deleted', entityId: 1 }),
    )
  })

  it('remove throws 404 when nothing deleted', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(remove(99, adminActor)).rejects.toMatchObject({ status: 404 })
  })

  it('list excludes deleted users in both role-filtered and full queries', async () => {
    query.mockResolvedValue({ rows: [] })
    await list()
    await list({ id: 1, role: 'administrator' as const })
    expect(query.mock.calls[0]?.[0]).toContain('is_deleted = FALSE')
    expect(query.mock.calls[1]?.[0]).toContain('is_deleted = FALSE')
  })

  it('create duplicate checks ignore deleted accounts', async () => {
    query.mockResolvedValueOnce({ rows: [] }) // email check
    query.mockResolvedValueOnce({ rows: [] }) // username check
    query.mockImplementation(async () => ({ rows: [] }))
    await create(
      {
        email: 'gone@h.com',
        username: 'gone',
        password: 'secret1',
        role: 'doctor',
        firstName: 'G',
        lastName: 'O',
      },
      { id: 1, role: 'administrator' as const },
    ).catch(() => undefined)
    expect(query.mock.calls[0]?.[0]).toContain('AND is_deleted = FALSE')
    expect(query.mock.calls[1]?.[0]).toContain('AND is_deleted = FALSE')
  })
})
