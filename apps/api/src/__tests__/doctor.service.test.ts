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

import { create, getById, getByUserId, list, remove, update } from '../services/doctor.service'
import type { ClinicScope } from '../lib/scope'

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
    clinic_id: 1,
    clinic_name: 'Radiology',
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ...overrides,
  }
}

// SQL-keyed routing: dup checks, inserts, and selects stay stable as the
// number of intermediate queries evolves.
function installDb(rows: Record<string, unknown>[] = [doctorRow()]) {
  query.mockImplementation(async (...args: unknown[]) => {
    const sql = String(args[0] ?? '')
    if (sql.includes('WHERE email =')) return { rows: [] }
    if (sql.includes('WHERE username =')) return { rows: [] }
    if (sql.includes('INSERT INTO users')) return { rows: [{ id: 10 }] }
    if (sql.includes('INSERT INTO doctors')) return { rows: [{ id: 1 }] }
    return { rows }
  })
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
  const scope = (clinicId: number): ClinicScope => ({ kind: 'clinic', clinicId })
  const actor = { id: 2, role: 'administrator' as const, clinicId: 1 }
  const managerActor = { id: 5, role: 'manager' as const, clinicId: null }
  const superadminActor = { id: 3, role: 'superadmin' as const, clinicId: null }

  it('list maps joined rows to Doctor within the clinic scope', async () => {
    query.mockResolvedValue({ rows: [doctorRow(), doctorRow({ id: 2, email: 'x@y.z' })] })
    const ds = await list(scope(1))
    expect(ds).toHaveLength(2)
    expect(ds[0]?.firstName).toBe('Jane')
    expect(ds[0]?.clinicId).toBe(1)
    expect(ds[0]?.clinicName).toBe('Radiology')
    expect(typeof ds[0]?.createdAt).toBe('string')
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('d.clinic_id = $1')
    expect(query.mock.calls[0]?.[1]).toEqual([1])
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

  it('getById hides a cross-clinic row from an administrator (404)', async () => {
    query.mockResolvedValueOnce({ rows: [doctorRow({ clinic_id: 2 })] })
    await expect(getById(1, actor)).rejects.toMatchObject({ status: 404 })
  })

  it('getById passes for manager and superadmin on any clinic', async () => {
    query.mockResolvedValueOnce({ rows: [doctorRow({ clinic_id: 2 })] })
    const m = await getById(1, managerActor)
    expect(m.clinicId).toBe(2)
    query.mockResolvedValueOnce({ rows: [doctorRow({ clinic_id: 2 })] })
    const sa = await getById(1, superadminActor)
    expect(sa.clinicId).toBe(2)
  })

  it('create rejects duplicate email with 409', async () => {
    query.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? '')
      if (sql.includes('FROM clinics')) return { rows: [{ is_active: true }] }
      if (sql.includes('WHERE email =')) return { rows: [{ id: 9 }] }
      return { rows: [] }
    })
    await expect(
      create(
        { email: 'd@h.com', username: 'dr1', password: 'secret1', firstName: 'J', lastName: 'R' },
        actor,
        scope(1),
      ),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('create into an unknown clinic is 404, inactive clinic is 403', async () => {
    query.mockImplementation(async () => ({ rows: [] }))
    await expect(
      create(
        { email: 'd@h.com', username: 'dr1', password: 'secret1', firstName: 'J', lastName: 'R' },
        actor,
        scope(99),
      ),
    ).rejects.toMatchObject({ status: 404 })

    query.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? '')
      if (sql.includes('FROM clinics')) return { rows: [{ is_active: false }] }
      return { rows: [] }
    })
    await expect(
      create(
        { email: 'd@h.com', username: 'dr1', password: 'secret1', firstName: 'J', lastName: 'R' },
        actor,
        scope(1),
      ),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('create writes the scope clinic into BOTH users and doctors (equality invariant, I5)', async () => {
    installDb([doctorRow({ id: 1, user_id: 10, max_monthly_duties: 5 })])
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
      scope(1),
    )
    expect(d.userId).toBe(10)
    expect(d.maxMonthlyDuties).toBe(5)
    expect(d.clinicId).toBe(1)
    const insertUser = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO users'))
    expect(String(insertUser?.[0])).toContain("'doctor'")
    expect(insertUser?.[1]?.[5]).toBe(1)
    const insertDoctor = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO doctors'))
    expect(insertDoctor?.[1]?.[1]).toBe(1) // doctors.clinic_id = users.clinic_id
    expect(hash).toHaveBeenCalledWith('secret1', 12)
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'doctor.created', entityId: 1, clinicId: 1 }),
    )
  })

  it('update writes users + doctors tables when both field groups are present', async () => {
    query
      .mockResolvedValueOnce({ rows: [doctorRow({ id: 1, user_id: 5 })] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE users
      .mockResolvedValueOnce({ rows: [] }) // UPDATE doctors
      .mockResolvedValueOnce({ rows: [doctorRow({ id: 1, user_id: 5, max_monthly_duties: 3 })] })
    const d = await update(1, { firstName: 'Janet', maxMonthlyDuties: 3 }, actor)
    expect(d.maxMonthlyDuties).toBe(3)
    const updateUserSql = query.mock.calls[1]?.[0] as string
    expect(updateUserSql).toContain('UPDATE users')
    expect(updateUserSql).toContain('first_name')
    const updateDoctorSql = query.mock.calls[2]?.[0] as string
    expect(updateDoctorSql).toContain('UPDATE doctors')
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'doctor.updated', entityId: 1, clinicId: 1 }),
    )
  })

  it('update hides a cross-clinic row from an administrator (404)', async () => {
    query.mockResolvedValueOnce({ rows: [doctorRow({ clinic_id: 2 })] })
    await expect(update(1, { firstName: 'X' }, actor)).rejects.toMatchObject({ status: 404 })
  })

  it('remove soft-deletes: sets is_deleted and is_active, revokes tokens, keeps rows', async () => {
    query
      .mockResolvedValueOnce({ rows: [doctorRow({ id: 2, user_id: 7 })] })
      .mockResolvedValueOnce({ rows: [] }) // draft-duty check: none
      .mockResolvedValueOnce({ rows: [] }) // UPDATE users
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
      expect.objectContaining({ action: 'doctor.deleted', entityId: 2, clinicId: 1 }),
    )
  })

  it('remove throws 409 when the doctor has duties in a draft schedule', async () => {
    query.mockResolvedValueOnce({ rows: [doctorRow({ id: 2, user_id: 7 })] })
    query.mockResolvedValueOnce({ rows: [{ 1: 1 }] }) // draft duty found
    await expect(remove(2, actor)).rejects.toMatchObject({ status: 409 })
    expect(revokeAllForUser).not.toHaveBeenCalled()
  })

  it('remove allows deletion when duties exist only in published schedules', async () => {
    query
      .mockResolvedValueOnce({ rows: [doctorRow({ id: 2, user_id: 7 })] })
      .mockResolvedValueOnce({ rows: [] }) // draft-duty check: none
      .mockResolvedValueOnce({ rows: [] }) // UPDATE users
    await remove(2, actor)
    expect(revokeAllForUser).toHaveBeenCalledWith(7)
  })

  it('remove throws 404 when doctor missing or cross-clinic', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(remove(99, actor)).rejects.toMatchObject({ status: 404 })
    query.mockResolvedValueOnce({ rows: [doctorRow({ clinic_id: 2 })] })
    await expect(remove(1, actor)).rejects.toMatchObject({ status: 404 })
  })

  it('getById excludes deleted doctors (404)', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(getById(2, actor)).rejects.toMatchObject({ status: 404 })
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('u.is_deleted = FALSE')
  })

  it('create duplicate checks ignore deleted accounts', async () => {
    installDb()
    await create(
      { email: 'd@h.com', username: 'dr1', password: 'secret1', firstName: 'J', lastName: 'R' },
      actor,
      scope(1),
    )
    const emailCheck = query.mock.calls.find((c) => String(c[0]).includes('WHERE email ='))
    const usernameCheck = query.mock.calls.find((c) => String(c[0]).includes('WHERE username ='))
    expect(String(emailCheck?.[0])).toContain('AND is_deleted = FALSE')
    expect(String(usernameCheck?.[0])).toContain('AND is_deleted = FALSE')
  })
})
