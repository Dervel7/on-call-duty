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

import { create, getById, list, remove, resetPassword, update, updateTheme } from '../services/user.service'
import type { ClinicScope } from '../lib/scope'

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    email: 'd@h.com',
    username: 'dr1',
    password_hash: 'HASH',
    role: 'doctor',
    first_name: 'Jane',
    last_name: 'Roe',
    dark_mode: false,
    clinic_id: 1,
    clinic_name: 'Radiology',
    created_at: new Date('2026-01-01'),
    ...overrides,
  }
}

// Route every create/update query: clinic usability, dup checks, and the
// business statement itself.
function installDb(rows: Record<string, unknown>[] = [row()]) {
  query.mockImplementation(async (...args: unknown[]) => {
    const sql = String(args[0] ?? '')
    if (sql.includes('FROM clinics')) return { rows: [{ is_active: true }] }
    if (sql.includes('WHERE email =')) return { rows: [] }
    if (sql.includes('WHERE username =')) return { rows: [] }
    return { rows }
  })
}

const validDoctor = {
  email: 'd@h.com',
  username: 'dr1',
  password: 'secret1',
  role: 'doctor' as const,
  firstName: 'J',
  lastName: 'R',
}

beforeEach(() => {
  query.mockReset()
  hash.mockReset()
  hash.mockResolvedValue('HASH')
  logActivity.mockReset()
  recordActivity.mockReset()
})

describe('user.service', () => {
  const scope = (clinicId: number): ClinicScope => ({ kind: 'clinic', clinicId })
  const adminActor = { id: 2, role: 'administrator' as const, clinicId: 1 }
  const superadminActor = { id: 3, role: 'superadmin' as const, clinicId: null }
  const managerActor = { id: 4, role: 'manager' as const, clinicId: null }

  it('list maps rows to User', async () => {
    query.mockResolvedValue({ rows: [row(), row({ id: 2, email: 'x@y.z' })] })
    const users = await list(adminActor, scope(1))
    expect(users).toHaveLength(2)
    expect(users[0]?.firstName).toBe('Jane')
    expect(users[0]?.clinicName).toBe('Radiology')
    expect(typeof users[0]?.createdAt).toBe('string')
  })

  it('list is clinic-scoped and hides hospital roles from non-superadmins', async () => {
    query.mockResolvedValue({ rows: [row()] })
    await list(adminActor, scope(1))
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('u.clinic_id = $1')
    expect(sql).toContain(`role NOT IN ('superadmin', 'manager')`)
    expect(query.mock.calls[0]?.[1]).toEqual([1])
  })

  it('list for a superadmin keeps the clinic scope but shows every role', async () => {
    query.mockResolvedValue({ rows: [row()] })
    await list(superadminActor, scope(1))
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('u.clinic_id = $1')
    expect(sql).not.toContain('role NOT IN')
  })

  it('getById hides a cross-clinic row from an administrator (404)', async () => {
    query.mockResolvedValueOnce({ rows: [row({ clinic_id: 2 })] })
    await expect(getById(1, adminActor)).rejects.toMatchObject({ status: 404 })
  })

  it('getById hides hospital roles from a manager and from an administrator (404)', async () => {
    query.mockResolvedValueOnce({ rows: [row({ role: 'manager' })] })
    await expect(getById(1, managerActor)).rejects.toMatchObject({ status: 404 })
    query.mockResolvedValueOnce({ rows: [row({ role: 'superadmin', clinic_id: 1 })] })
    await expect(getById(1, adminActor)).rejects.toMatchObject({ status: 404 })
  })

  it('getById resolves a same-clinic row and hospital rows for a superadmin', async () => {
    query.mockResolvedValueOnce({ rows: [row()] })
    const u = await getById(1, adminActor)
    expect(u.id).toBe(1)
    query.mockResolvedValueOnce({ rows: [row({ role: 'superadmin' })] })
    const sa = await getById(1, superadminActor)
    expect(sa.role).toBe('superadmin')
  })

  it('create rejects duplicate email with 409', async () => {
    query.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? '')
      if (sql.includes('FROM clinics')) return { rows: [{ is_active: true }] }
      if (sql.includes('WHERE email =')) return { rows: [{ id: 9 }] }
      return { rows: [] }
    })
    await expect(create(validDoctor, adminActor)).rejects.toMatchObject({ status: 409 })
  })

  it('create rejects duplicate username with 409', async () => {
    query.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? '')
      if (sql.includes('FROM clinics')) return { rows: [{ is_active: true }] }
      if (sql.includes('WHERE username =')) return { rows: [{ id: 9 }] }
      return { rows: [] }
    })
    await expect(create(validDoctor, adminActor)).rejects.toMatchObject({ status: 409 })
  })

  it('create hashes the password, forces the actor clinic and audits with it (I3)', async () => {
    installDb()
    const u = await create(
      { ...validDoctor, firstName: 'Jane', lastName: 'Roe', clinicId: 2 }, // payload clinic ignored
      adminActor,
    )
    expect(hash).toHaveBeenCalledWith('secret1', 12)
    expect(u.email).toBe('d@h.com')
    const insert = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO users'))
    expect(insert?.[1]?.[6]).toBe(1)
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'user.created', userId: 2, entityId: 1, clinicId: 1 }),
    )
  })

  it('create rejects superadmin/manager roles from an administrator actor with 403', async () => {
    for (const role of ['superadmin', 'manager'] as const) {
      await expect(
        create({ ...validDoctor, role, username: `u-${role}` }, adminActor),
      ).rejects.toMatchObject({ status: 403 })
    }
    expect(query).not.toHaveBeenCalled()
  })

  it('create by a manager only allows administrator accounts into a named clinic (I17/I18)', async () => {
    await expect(create(validDoctor, managerActor)).rejects.toMatchObject({ status: 403 })

    await expect(
      create(
        {
          email: 'a@h.com',
          username: 'adm1',
          password: 'secret1',
          role: 'administrator',
          firstName: 'A',
          lastName: 'B',
        },
        managerActor,
      ),
    ).rejects.toMatchObject({ status: 400, message: 'clinicId is required' })

    installDb([row({ email: 'a@h.com', role: 'administrator', clinic_id: 2, clinic_name: 'Cardiology' })])
    const u = await create(
      {
        email: 'a@h.com',
        username: 'adm1',
        password: 'secret1',
        role: 'administrator',
        firstName: 'A',
        lastName: 'B',
        clinicId: 2,
      },
      managerActor,
    )
    expect(u.email).toBe('a@h.com')
    expect(u.clinicId).toBe(2)
    const insert = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO users'))
    expect(insert?.[1]?.[3]).toBe('administrator')
    expect(insert?.[1]?.[6]).toBe(2)
  })

  it('create by a manager into an unknown clinic is 404', async () => {
    query.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? '')
      if (sql.includes('FROM clinics')) return { rows: [] }
      return { rows: [] }
    })
    await expect(
      create(
        {
          email: 'a@h.com',
          username: 'adm1',
          password: 'secret1',
          role: 'administrator',
          firstName: 'A',
          lastName: 'B',
          clinicId: 99,
        },
        managerActor,
      ),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('update builds a partial SET clause', async () => {
    query
      .mockResolvedValueOnce({ rows: [row()] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // UPDATE ... RETURNING id
      .mockResolvedValueOnce({ rows: [row({ is_active: false })] }) // re-select
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
    query
      .mockResolvedValueOnce({ rows: [row()] })
      .mockResolvedValueOnce({ rows: [row()] })
      .mockResolvedValueOnce({ rows: [row()] }) // getById re-select on the early return
    const u = await update(1, { email: 'd@h.com' }, adminActor)
    expect(u.email).toBe('d@h.com')
    expect(recordActivity).not.toHaveBeenCalled()
  })

  it('update records the audit row when a field changes', async () => {
    query
      .mockResolvedValueOnce({ rows: [row()] })
      .mockResolvedValueOnce({ rows: [] }) // duplicate-email check
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // UPDATE ... RETURNING id
      .mockResolvedValueOnce({ rows: [row({ email: 'new@h.com' })] }) // re-select
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
  it('update hides a superadmin row from an administrator (404, existence hidden)', async () => {
    query.mockResolvedValueOnce({ rows: [row({ role: 'superadmin' })] })
    await expect(update(1, { isActive: false }, adminActor)).rejects.toMatchObject({ status: 404 })
  })
  it('update rejects a username already used by another live account with 409', async () => {
    query.mockResolvedValueOnce({ rows: [row()] })
    query.mockResolvedValueOnce({ rows: [{ id: 9 }] })
    await expect(update(1, { username: 'taken' }, adminActor)).rejects.toMatchObject({
      status: 409,
      message: 'Username already in use',
    })
  })



  it('update rejects promoting a user to superadmin from a non-superadmin actor with 403', async () => {
    query.mockResolvedValueOnce({ rows: [row()] })
    await expect(update(1, { role: 'superadmin' }, adminActor)).rejects.toMatchObject({
      status: 403,
    })
  })

  it('update allows a superadmin actor to manage superadmin accounts', async () => {
    query
      .mockResolvedValueOnce({ rows: [row({ role: 'superadmin', clinic_id: null })] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [row({ role: 'superadmin', is_active: false, clinic_id: null })] })
    const u = await update(1, { isActive: false }, superadminActor)
    expect(u.isActive).toBe(false)
  })

  it('update forbids clinic reassignment by an administrator (403) (I24)', async () => {
    query.mockResolvedValueOnce({ rows: [row()] })
    await expect(update(1, { clinicId: 2 }, adminActor)).rejects.toMatchObject({ status: 403 })
  })

  it('update by a superadmin moving a doctor syncs doctors.clinic_id in-transaction', async () => {
    query
      .mockResolvedValueOnce({ rows: [row()] }) // existing
      .mockResolvedValueOnce({ rows: [{ is_active: true }] }) // clinic check
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // UPDATE users RETURNING id
      .mockResolvedValueOnce({ rows: [] }) // UPDATE doctors
      .mockResolvedValueOnce({ rows: [row({ clinic_id: 2, clinic_name: 'Cardiology' })] }) // re-select
    const u = await update(1, { clinicId: 2 }, superadminActor)
    expect(u.clinicId).toBe(2)
    const doctorSync = query.mock.calls.find((c) => String(c[0]).includes('UPDATE doctors'))
    expect(doctorSync?.[1]).toEqual([2, 1])
  })

  it('update by a manager cannot touch doctor accounts (403)', async () => {
    query.mockResolvedValueOnce({ rows: [row()] })
    await expect(update(1, { isActive: false }, managerActor)).rejects.toMatchObject({ status: 403 })
  })

  it('remove hides a superadmin row from an administrator (404)', async () => {
    query.mockResolvedValueOnce({ rows: [row({ role: 'superadmin' })] })
    await expect(remove(1, adminActor)).rejects.toMatchObject({ status: 404 })
  })

  it('remove rejects a manager deleting a doctor with 403', async () => {
    query.mockResolvedValueOnce({ rows: [row()] })
    await expect(remove(1, managerActor)).rejects.toMatchObject({ status: 403 })
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
      expect.objectContaining({ action: 'user.deleted', entityId: 1, clinicId: 1 }),
    )
  })

  it('remove throws 404 when nothing deleted', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(remove(99, adminActor)).rejects.toMatchObject({ status: 404 })
  })

  it('resetPassword hashes with bcrypt 12, updates password_hash and revokes sessions', async () => {
    query
      .mockResolvedValueOnce({ rows: [row()] }) // existing (getById)
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // UPDATE ... RETURNING id
      .mockResolvedValueOnce({ rows: [] }) // revokeAllForUser (refresh_tokens)
      .mockResolvedValueOnce({ rows: [row()] }) // getById re-select
    const u = await resetPassword(1, { newPassword: 'secret1' }, adminActor)
    expect(u.email).toBe('d@h.com')
    expect(hash).toHaveBeenCalledWith(expect.any(String), 12)
    const upd = query.mock.calls.find((c) => String(c[0]).includes('SET password_hash'))
    expect(upd?.[1]).toEqual(['HASH', 1])
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'user.password_reset', userId: 2, entityId: 1, clinicId: 1 }),
    )
    expect(query.mock.calls.some((c) => String(c[0]).includes('refresh_tokens'))).toBe(true)
  })

  it('resetPassword hides a superadmin row from an administrator (404, existence hidden)', async () => {
    query.mockResolvedValueOnce({ rows: [row({ role: 'superadmin', clinic_id: null })] })
    await expect(resetPassword(1, { newPassword: 'secret1' }, adminActor)).rejects.toMatchObject({ status: 404 })
  })

  it('resetPassword rejects a manager resetting a doctor password with 403', async () => {
    query.mockResolvedValueOnce({ rows: [row()] })
    await expect(resetPassword(1, { newPassword: 'secret1' }, managerActor)).rejects.toMatchObject({ status: 403 })
  })

  it('resetPassword throws 404 for an unknown id', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(resetPassword(99, { newPassword: 'secret1' }, adminActor)).rejects.toMatchObject({ status: 404 })
  })

  it('create duplicate checks ignore deleted accounts', async () => {
    query.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? '')
      if (sql.includes('FROM clinics')) return { rows: [{ is_active: true }] }
      return { rows: [] }
    })
    await create(validDoctor, adminActor).catch(() => undefined)
    const emailCheck = query.mock.calls.find((c) => String(c[0]).includes('WHERE email ='))
    const usernameCheck = query.mock.calls.find((c) => String(c[0]).includes('WHERE username ='))
    expect(String(emailCheck?.[0])).toContain('AND is_deleted = FALSE')
    expect(String(usernameCheck?.[0])).toContain('AND is_deleted = FALSE')
  })

  it('updateTheme persists the preference and returns the user', async () => {
    query.mockResolvedValue({ rows: [row({ dark_mode: true })] })
    const user = await updateTheme(1, true)
    expect(user.darkMode).toBe(true)
    const sql = query.mock.calls[0]?.[0] as string
    expect(sql).toContain('UPDATE users u SET dark_mode = $1')
    expect(sql).toContain('RETURNING')
    expect(query.mock.calls[0]?.[1]).toEqual([true, 1])
  })

  it('updateTheme throws 404 when the user does not exist', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(updateTheme(99, true)).rejects.toMatchObject({ status: 404 })
  })
})
