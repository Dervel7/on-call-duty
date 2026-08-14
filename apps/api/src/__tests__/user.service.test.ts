import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({ query: (...a: unknown[]) => query(...a) }))

const { hash } = vi.hoisted(() => ({ hash: vi.fn(async () => 'HASH') }))
vi.mock('bcrypt', () => ({ default: { hash } }))

import { create, list, remove, update } from '../services/user.service'

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

  it('remove throws 404 when nothing deleted', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(remove(99)).rejects.toMatchObject({ status: 404 })
  })
})
