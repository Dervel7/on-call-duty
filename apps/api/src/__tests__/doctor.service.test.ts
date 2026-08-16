import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (client: { query: typeof query }) => Promise<unknown>) =>
    work({ query }),
}))

const logActivity = vi.fn()
const recordActivity = vi.fn()
vi.mock('../services/activity.service', () => ({
  logActivity: (...a: unknown[]) => logActivity(...a),
  recordActivity: (...a: unknown[]) => recordActivity(...a),
}))

const hash = vi.fn(async (..._a: unknown[]) => 'HASH')
vi.mock('bcrypt', () => ({ default: { hash: (...a: unknown[]) => hash(...a) } }))

const revokeAllForUser = vi.fn(async (..._a: unknown[]) => undefined)
vi.mock('../services/token.service', () => ({
  revokeAllForUser: (...a: unknown[]) => revokeAllForUser(...a),
}))

import {
  create,
  getById,
  getByUserId,
  list,
  remove,
  update,
} from '../services/doctor.service'

function doctorRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    user_id: 10,
    email: 'd@h.com',
    username: 'dr1',
    first_name: 'Jane',
    last_name: 'Roe',
    is_active: true,
    max_monthly_duties: 7,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ...overrides,
  }
}

beforeEach(() => {
  query.mockReset()
  hash.mockReset()
  hash.mockResolvedValue('HASH')
  logActivity.mockReset()
  recordActivity.mockReset()
  revokeAllForUser.mockReset()
  revokeAllForUser.mockResolvedValue(undefined)
})

describe('doctor.service', () => {
  const actor = { id: 2, role: 'administrator' as const }
  it('list maps joined rows to Doctor', async () => {
    query.mockResolvedValue({ rows: [doctorRow(), doctorRow({ id: 2, email: 'x@y.z' })] })
    const ds = await list()
    expect(ds).toHaveLength(2)
    expect(ds[0]?.firstName).toBe('Jane')
    expect(typeof ds[0]?.createdAt).toBe('string')
  })

  it('getByUserId throws 404 when no profile (used by /me)', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(getByUserId(9)).rejects.toMatchObject({ status: 404 })
  })

  it('getByUserId excludes deleted doctors (404)', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(getByUserId(10)).rejects.toMatchObject({ status: 404 })
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('u.is_deleted = FALSE')
  })

  it('create rejects duplicate email with 409', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 9 }] })
    await expect(
      create(
        { email: 'd@h.com', username: 'dr1', password: 'secret1', firstName: 'J', lastName: 'R' },
        actor,
      ),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('create inserts user (role=doctor) + doctor in a transaction and returns the joined doctor', async () => {
    let n = 0
    query.mockImplementation(async () => {
      n++
      if (n === 1) return { rows: [] }
      if (n === 2) return { rows: [] }
      if (n === 3) return { rows: [{ id: 10 }] }
      if (n === 4) return { rows: [{ id: 1 }] }
      return { rows: [doctorRow({ id: 1, user_id: 10, max_monthly_duties: 5 })] }
    })
    const d = await create(
      {
        email: 'd@h.com',
        username: 'dr1',
        password: 'secret1',
        firstName: 'Jane',
        lastName: 'Roe',
        maxMonthlyDuties: 5,
      },
      actor,
    )
    expect(d.userId).toBe(10)
    expect(d.maxMonthlyDuties).toBe(5)
    const insertUserSql = query.mock.calls[2]?.[0] as string
    expect(insertUserSql).toContain("'doctor'")
    expect((query.mock.calls[3]?.[1] as unknown[])).toEqual([10, 5])
    expect(hash).toHaveBeenCalledWith('secret1', 12)
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'doctor.created', entityId: 1 }),
    )
  })

  it('update writes users + doctors tables when both field groups are present', async () => {
    query.mockResolvedValueOnce({ rows: [doctorRow({ id: 1, user_id: 5 })] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [] })
    query.mockResolvedValueOnce({ rows: [doctorRow({ id: 1, user_id: 5, max_monthly_duties: 3 })] })
    const d = await update(1, { firstName: 'Janet', maxMonthlyDuties: 3 }, actor)
    expect(d.maxMonthlyDuties).toBe(3)
    const updateUserSql = query.mock.calls[1]?.[0] as string
    expect(updateUserSql).toContain('UPDATE users')
    expect(updateUserSql).toContain('first_name')
    const updateDoctorSql = query.mock.calls[2]?.[0] as string
    expect(updateDoctorSql).toContain('UPDATE doctors')
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'doctor.updated', entityId: 1 }),
    )
  })

  it('remove soft-deletes: sets is_deleted and is_active, revokes tokens, keeps rows', async () => {
    query.mockResolvedValueOnce({ rows: [doctorRow({ id: 2, user_id: 7 })] })
    query.mockResolvedValueOnce({ rows: [] }) // draft-duty check: none
    query.mockResolvedValueOnce({ rows: [] }) // UPDATE users
    await remove(2, actor)
    const draftCheck = query.mock.calls[1]?.[0] as string
    expect(draftCheck).toContain("s.status = 'draft'")
    const upd = query.mock.calls[2]?.[0] as string
    expect(upd).toContain('UPDATE users')
    expect(upd).toContain('is_deleted = TRUE')
    expect(upd).toContain('is_active = FALSE')
    expect((query.mock.calls[2]?.[1] as unknown[])[0]).toBe(7)
    expect(query.mock.calls.some((c) => String(c[0]).includes('DELETE FROM users'))).toBe(false)
    expect(revokeAllForUser).toHaveBeenCalledWith(7)
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'doctor.deleted', entityId: 2 }),
    )
  })

  it('remove throws 409 when the doctor has duties in a draft schedule', async () => {
    query.mockResolvedValueOnce({ rows: [doctorRow({ id: 2, user_id: 7 })] })
    query.mockResolvedValueOnce({ rows: [{ 1: 1 }] }) // draft duty found
    await expect(remove(2, actor)).rejects.toMatchObject({ status: 409 })
    expect(revokeAllForUser).not.toHaveBeenCalled()
  })

  it('remove allows deletion when duties exist only in published schedules', async () => {
    query.mockResolvedValueOnce({ rows: [doctorRow({ id: 2, user_id: 7 })] })
    query.mockResolvedValueOnce({ rows: [] }) // draft-duty check: none
    query.mockResolvedValueOnce({ rows: [] }) // UPDATE users
    await remove(2, actor)
    expect(revokeAllForUser).toHaveBeenCalledWith(7)
  })

  it('remove throws 404 when doctor missing', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(remove(99, actor)).rejects.toMatchObject({ status: 404 })
  })

  it('getById excludes deleted doctors (404)', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(getById(2)).rejects.toMatchObject({ status: 404 })
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('u.is_deleted = FALSE')
  })

  it('create duplicate checks ignore deleted accounts', async () => {
    let n = 0
    query.mockImplementation(async () => {
      n++
      if (n === 1) return { rows: [] } // email check
      if (n === 2) return { rows: [] } // username check
      if (n === 3) return { rows: [{ id: 10 }] }
      if (n === 4) return { rows: [{ id: 1 }] }
      return { rows: [doctorRow({ id: 1 })] }
    })
    await create(
      { email: 'd@h.com', username: 'dr1', password: 'secret1', firstName: 'J', lastName: 'R' },
      actor,
    )
    expect(query.mock.calls[0]?.[0]).toContain('AND is_deleted = FALSE')
    expect(query.mock.calls[1]?.[0]).toContain('AND is_deleted = FALSE')
  })
})
