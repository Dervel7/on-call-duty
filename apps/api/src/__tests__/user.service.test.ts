import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client.ts', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

const logActivity = vi.fn()
const recordActivity = vi.fn()
vi.mock('../services/activity.service.ts', () => ({
  logActivity: (...a: unknown[]) => logActivity(...a),
  recordActivity: (...a: unknown[]) => recordActivity(...a),
}))

const { hash } = vi.hoisted(() => ({ hash: vi.fn(async () => 'HASH') }))
vi.mock('bcrypt', () => ({ default: { hash } }))

import {
  create,
  getById,
  list,
  remove,
  resetPassword,
  update,
  updateLanguage,
  updateTheme,
} from '../services/user.service.ts'
import type { ClinicScope } from '../lib/scope.ts'

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    email: 'd@h.com',
    username: 'dr1',
    password_hash: 'HASH',
    role: 'administrator',
    first_name: 'Jane',
    last_name: 'Roe',
    dark_mode: false,
    language: 'en',
    is_active: true,
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
    if (sql.includes('WHERE lower(email) =')) return { rows: [] }
    if (sql.includes('WHERE username =')) return { rows: [] }
    return { rows }
  })
}

const validAdmin = {
  email: 'd@h.com',
  username: 'dr1',
  password: 'secret1',
  role: 'administrator' as const,
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
  const scope = (clinicId: number): ClinicScope => ({ clinicId })
  const adminActor = { id: 2, role: 'administrator' as const, clinicId: 1 }
  const superadminActor = { id: 3, role: 'superadmin' as const, clinicId: null }
  const managerActor = { id: 4, role: 'manager' as const, clinicId: null }

  it('list maps rows to User', async () => {
    query.mockResolvedValue({ rows: [row(), row({ id: 2, email: 'x@y.z' })] })
    const users = await list(scope(1))
    expect(users).toHaveLength(2)
    expect(users[0]?.firstName).toBe('Jane')
    expect(users[0]?.clinicName).toBe('Radiology')
    expect(typeof users[0]?.createdAt).toBe('string')
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
      if (sql.includes('WHERE lower(email) =')) return { rows: [{ id: 9 }] }
      return { rows: [] }
    })
    await expect(create(validAdmin, adminActor)).rejects.toMatchObject({ status: 409 })
  })

  it('create rejects duplicate username with 409', async () => {
    query.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? '')
      if (sql.includes('FROM clinics')) return { rows: [{ is_active: true }] }
      if (sql.includes('WHERE username =')) return { rows: [{ id: 9 }] }
      return { rows: [] }
    })
    await expect(create(validAdmin, adminActor)).rejects.toMatchObject({ status: 409 })
  })

  it('create hashes the password, forces the actor clinic and audits with it (I3)', async () => {
    installDb()
    const u = await create(
      { ...validAdmin, firstName: 'Jane', lastName: 'Roe', clinicId: 2 }, // payload clinic ignored
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
        create({ ...validAdmin, role, username: `u-${role}` }, adminActor),
      ).rejects.toMatchObject({ status: 403 })
    }
    expect(query).not.toHaveBeenCalled()
  })

  it('create by a manager only allows administrator accounts into a named clinic (I17/I18)', async () => {
    await expect(create({ ...validAdmin, role: 'doctor' }, managerActor)).rejects.toMatchObject({ status: 403 })

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
      .mockResolvedValueOnce({ rows: [{ id: 9 }] }) // another active administrator remains
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // UPDATE ... RETURNING id
      .mockResolvedValueOnce({ rows: [row({ is_active: false })] }) // re-select
    const u = await update(1, { isActive: false }, adminActor)
    expect(u.isActive).toBe(false)
    const sql = query.mock.calls[2]?.[0] as string
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
      .mockResolvedValueOnce({ rows: [row()] }) // re-select after the no-op UPDATE
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
      .mockResolvedValueOnce({ rows: [{ id: 5 }] }) // another active superadmin
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
      .mockResolvedValueOnce({ rows: [row({ role: 'doctor' })] }) // existing
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
    query.mockResolvedValueOnce({ rows: [row({ role: 'doctor' })] })
    await expect(update(1, { isActive: false }, managerActor)).rejects.toMatchObject({ status: 403 })
  })

  it('remove hides a superadmin row from an administrator (404)', async () => {
    query.mockResolvedValueOnce({ rows: [row({ role: 'superadmin' })] })
    await expect(remove(1, adminActor)).rejects.toMatchObject({ status: 404 })
  })

  it('remove rejects a manager deleting a doctor with 403', async () => {
    query.mockResolvedValueOnce({ rows: [row({ role: 'doctor' })] })
    await expect(remove(1, managerActor)).rejects.toMatchObject({ status: 403 })
  })

  it('remove soft-deletes the user and records the audit row in-transaction', async () => {
    query.mockResolvedValueOnce({ rows: [row()] })
    query.mockResolvedValueOnce({ rows: [{ id: 9 }] }) // another active administrator remains
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    await remove(1, adminActor)
    const upd = query.mock.calls[2]?.[0] as string
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
    query.mockResolvedValueOnce({ rows: [row({ role: 'doctor' })] })
    await expect(resetPassword(1, { newPassword: 'secret1' }, managerActor)).rejects.toMatchObject({ status: 403 })
  })

  it('resetPassword throws 404 for an unknown id', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(resetPassword(99, { newPassword: 'secret1' }, adminActor)).rejects.toMatchObject({ status: 404 })
  })

  describe('role escalation (ADM-01)', () => {
    it.each([
      ['another user', 1],
      ['themselves', 2],
    ])('administrator promoting %s to manager is 403 and writes nothing', async (_who, targetId) => {
      query.mockResolvedValueOnce({ rows: [row({ id: targetId, role: 'administrator' })] })
      await expect(update(targetId, { role: 'manager' }, adminActor)).rejects.toMatchObject({ status: 403 })
      expect(query.mock.calls.some((c) => String(c[0]).includes('UPDATE users'))).toBe(false)
    })
  })

  describe('self and last-holder protection (ADM-03)', () => {
    const selfRow = row({ id: 2, role: 'administrator' })

    it('rejects self-delete, self-deactivate, self-demote and self-reset with 409', async () => {
      query.mockResolvedValue({ rows: [selfRow] })
      await expect(remove(2, adminActor)).rejects.toMatchObject({ status: 409 })
      await expect(update(2, { isActive: false }, adminActor)).rejects.toMatchObject({ status: 409 })
      await expect(update(2, { role: 'doctor' }, adminActor)).rejects.toMatchObject({ status: 409 })
      await expect(resetPassword(2, { newPassword: 'secret1' }, adminActor)).rejects.toMatchObject({ status: 409 })
      expect(query.mock.calls.some((c) => String(c[0]).includes('UPDATE users'))).toBe(false)
    })

    it('refuses to delete the last superadmin', async () => {
      query
        .mockResolvedValueOnce({ rows: [row({ role: 'superadmin', clinic_id: null })] })
        .mockResolvedValueOnce({ rows: [] }) // no other active superadmin
      await expect(remove(1, superadminActor)).rejects.toMatchObject({
        status: 409,
        message: 'Cannot remove the last superadmin',
      })
    })

    it('refuses to deactivate the last administrator of a clinic', async () => {
      query
        .mockResolvedValueOnce({ rows: [row({ role: 'administrator' })] })
        .mockResolvedValueOnce({ rows: [] })
      await expect(update(1, { isActive: false }, superadminActor)).rejects.toMatchObject({ status: 409 })
      expect(query.mock.calls.some((c) => String(c[0]).includes('UPDATE users'))).toBe(false)
    })

    it('deletes one of two administrators', async () => {
      query
        .mockResolvedValueOnce({ rows: [row({ role: 'administrator' })] })
        .mockResolvedValueOnce({ rows: [{ id: 5 }] }) // another active administrator in the clinic
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // UPDATE ... RETURNING id
      await expect(remove(1, superadminActor)).resolves.toBeUndefined()
    })
  })

  it('update rejects a clinicId for a hospital role with 400 instead of a constraint 500 (ADM-10)', async () => {
    query.mockResolvedValueOnce({ rows: [row()] })
    await expect(update(1, { role: 'manager', clinicId: 2 }, superadminActor)).rejects.toMatchObject({
      status: 400,
      message: 'Hospital roles carry no clinic',
    })
  })

  describe('doctor accounts live under /doctors (ADM-02, ADM-04)', () => {
    const noWrites = () => query.mock.calls.some((c) => String(c[0]).includes('UPDATE users'))

    it.each([adminActor, superadminActor])('create refuses role doctor (409) and writes nothing', async (actor) => {
      installDb()
      await expect(create({ ...validAdmin, role: 'doctor', clinicId: 1 }, actor)).rejects.toMatchObject({
        status: 409,
      })
      expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO users'))).toBe(false)
    })

    it('update refuses a role change into doctor (409)', async () => {
      query.mockResolvedValueOnce({ rows: [row({ role: 'administrator', id: 7 })] })
      await expect(update(7, { role: 'doctor' }, adminActor)).rejects.toMatchObject({ status: 409 })
      expect(noWrites()).toBe(false)
    })

    it.each([{ role: 'administrator' as const }, { isActive: false }, { email: 'x@h.com' }])(
      'update refuses %o on a doctor (409) and writes nothing',
      async (input) => {
        query.mockResolvedValueOnce({ rows: [row({ role: 'doctor', id: 7 })] })
        await expect(update(7, input, adminActor)).rejects.toMatchObject({ status: 409 })
        expect(noWrites()).toBe(false)
      },
    )

    it('remove refuses a doctor (409) and writes nothing', async () => {
      query.mockResolvedValueOnce({ rows: [row({ role: 'doctor', id: 7 })] })
      await expect(remove(7, adminActor)).rejects.toMatchObject({ status: 409 })
      expect(noWrites()).toBe(false)
    })

    it('a superadmin clinic move together with another field is refused', async () => {
      query.mockResolvedValueOnce({ rows: [row({ role: 'doctor', id: 7 })] })
      await expect(update(7, { clinicId: 2, firstName: 'X' }, superadminActor)).rejects.toMatchObject({
        status: 409,
      })
    })
  })

  describe('session revocation on deactivation (ADM-09)', () => {
    it('deactivating revokes refresh tokens; reactivating does not', async () => {
      query
        .mockResolvedValueOnce({ rows: [row()] })
        .mockResolvedValueOnce({ rows: [{ id: 9 }] }) // another active administrator remains
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [row({ is_active: false })] })
      await update(1, { isActive: false }, adminActor)
      expect(query.mock.calls.some((c) => String(c[0]).includes('refresh_tokens'))).toBe(true)

      query.mockReset()
      query
        .mockResolvedValueOnce({ rows: [row({ is_active: false })] })
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [row()] })
      await update(1, { isActive: true }, adminActor)
      expect(query.mock.calls.some((c) => String(c[0]).includes('refresh_tokens'))).toBe(false)
    })
  })

  it('updateTheme persists the preference and returns the user', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [row({ dark_mode: true, clinic_name: 'Radiology' })] })
    const user = await updateTheme(1, true)
    expect(user.darkMode).toBe(true)
    expect(user.clinicName).toBe('Radiology')
    expect(query.mock.calls[0]?.[1]).toEqual([true, 1])
  })

  it('updateTheme throws 404 when the user does not exist', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(updateTheme(99, true)).rejects.toMatchObject({ status: 404 })
  })

  it('updateLanguage saves the language for that user and returns it', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [row({ language: 'el', clinic_name: 'Radiology' })] })
    const user = await updateLanguage(1, 'el')
    expect(user.language).toBe('el')
    expect(user.clinicName).toBe('Radiology')
    expect(query.mock.calls[0]?.[1]).toEqual(['el', 1])
  })

  it('updateLanguage throws 404 when the user does not exist', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(updateLanguage(99, 'el')).rejects.toMatchObject({ status: 404 })
  })
})
