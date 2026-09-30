import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

import { resolveClinicScope } from '../lib/scope'

const admin = { id: 1, role: 'administrator' as const, clinicId: 1 }
const doctor = { id: 2, role: 'doctor' as const, clinicId: 2 }
const manager = { id: 3, role: 'manager' as const, clinicId: null }
const superadmin = { id: 4, role: 'superadmin' as const, clinicId: null }

beforeEach(() => query.mockReset())

describe('resolveClinicScope', () => {
  it('administrator/doctor are pinned to their JWT clinic without a db lookup', async () => {
    expect(await resolveClinicScope(admin, undefined)).toEqual({ kind: 'clinic', clinicId: 1 })
    expect(await resolveClinicScope(doctor, 2)).toEqual({ kind: 'clinic', clinicId: 2 })
    expect(query).not.toHaveBeenCalled()
  })

  it('administrator/doctor naming a foreign clinicId is 403', async () => {
    await expect(resolveClinicScope(admin, 9)).rejects.toMatchObject({ status: 403 })
    await expect(resolveClinicScope(doctor, 1)).rejects.toMatchObject({ status: 403 })
  })

  it('manager must name a clinic (400 without, no db lookup)', async () => {
    await expect(resolveClinicScope(manager, undefined)).rejects.toMatchObject({ status: 400 })
    expect(query).not.toHaveBeenCalled()
    expect(await resolveClinicScope(manager, 5)).toEqual({ kind: 'clinic', clinicId: 5 })
  })

  it('superadmin naming a clinic wins without a db lookup', async () => {
    expect(await resolveClinicScope(superadmin, 3)).toEqual({ kind: 'clinic', clinicId: 3 })
    expect(query).not.toHaveBeenCalled()
  })

  it('superadmin defaults to the sole clinic of a single-clinic deployment', async () => {
    query.mockResolvedValue({ rows: [{ id: 7 }] })
    expect(await resolveClinicScope(superadmin, undefined)).toEqual({ kind: 'clinic', clinicId: 7 })
    expect(query.mock.calls[0]?.[0]).toContain('FROM clinics')
    expect(query.mock.calls[0]?.[1]).toBeUndefined()
  })

  it('superadmin must name a clinic when the deployment has none or several', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await expect(resolveClinicScope(superadmin, undefined)).rejects.toMatchObject({ status: 400 })
    query.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] })
    await expect(resolveClinicScope(superadmin, undefined)).rejects.toMatchObject({ status: 400 })
  })

  it('unknown role is 403', async () => {
    await expect(
      resolveClinicScope({ id: 5, role: 'intern' as never, clinicId: null }, 1),
    ).rejects.toMatchObject({ status: 403 })
  })
})
