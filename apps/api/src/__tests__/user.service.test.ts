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
      create({ email: 'd@h.com', password: 'secret1', role: 'doctor', firstName: 'J', lastName: 'R' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('create hashes the password and inserts', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [row()] })
    const u = await create({
      email: 'd@h.com',
      password: 'secret1',
      role: 'doctor',
      firstName: 'Jane',
      lastName: 'Roe',
    })
    expect(hash).toHaveBeenCalledWith('secret1', 12)
    expect(u.email).toBe('d@h.com')
    const insertSql = query.mock.calls[1]?.[0] as string
    expect(insertSql).toContain('INSERT INTO users')
  })

  it('update builds a partial SET clause', async () => {
    query.mockResolvedValue({ rows: [row({ is_active: false })] })
    const u = await update(1, { isActive: false })
    expect(u.isActive).toBe(false)
    const sql = query.mock.calls[0]?.[0] as string
    const setClause = sql.split('WHERE')[0] as string
    expect(setClause).toContain('is_active = $1')
    expect(setClause).not.toContain('email')
  })

  it('remove throws 404 when nothing deleted', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(remove(99)).rejects.toMatchObject({ status: 404 })
  })
})
