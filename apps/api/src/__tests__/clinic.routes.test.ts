import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
}))
vi.mock('../services/billing.service', () => ({ isLocked: async () => false }))

import { errorHandler } from '../middleware/error-handler'
import { signAccessToken } from '../lib/jwt'
import { clinicRouter } from '../routes/clinic.routes'

function build() {
  const app = express()
  app.use(express.json())
  app.use('/clinics', clinicRouter)
  app.use(errorHandler)
  return app
}

const managerToken = () => signAccessToken({ sub: 5, role: 'manager', clinicId: null })
const superadminToken = () => signAccessToken({ sub: 1, role: 'superadmin', clinicId: null })
const adminToken = () => signAccessToken({ sub: 2, role: 'administrator', clinicId: 1 })
const doctorToken = () => signAccessToken({ sub: 10, role: 'doctor', clinicId: 10 })

function clinicRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Radiology',
    is_active: true,
    doctor_count: 3,
    admin_count: 1,
    created_at: new Date('2026-01-01'),
    ...overrides,
  }
}

// Route the service's queries: name-dup checks, inserts, and selects.
function installDb(rows: Record<string, unknown>[] = [clinicRow()]) {
  query.mockImplementation(async (...args: unknown[]) => {
    const sql = String(args[0] ?? '')
    if (sql.includes('INSERT INTO clinics')) return { rows: [{ id: 7 }] }
    if (sql.includes('SELECT id FROM clinics')) return { rows: [] } // name not taken
    return { rows }
  })
}

beforeEach(() => query.mockReset())

describe('clinics routes', () => {
  it('unauthenticated is 401', async () => {
    const res = await request(build()).get('/clinics')
    expect(res.status).toBe(401)
  })

  it('manager lists clinics with counts (200)', async () => {
    installDb([clinicRow(), clinicRow({ id: 2, name: 'Cardiology', doctor_count: 3 })])
    const res = await request(build()).get('/clinics').set('Authorization', `Bearer ${managerToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.data.clinics).toHaveLength(2)
    expect(res.body.data.clinics[0]).toMatchObject({
      id: 1,
      name: 'Radiology',
      isActive: true,
      doctorCount: 3,
      adminCount: 1,
    })
  })

  it('manager creates a clinic (201)', async () => {
    installDb()
    const res = await request(build())
      .post('/clinics')
      .set('Authorization', `Bearer ${managerToken()}`)
      .send({ name: 'Oncology' })
    expect(res.status).toBe(201)
    expect(res.body.data.clinic.name).toBe('Radiology') // re-selected by id
    const insert = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO clinics'))
    expect(insert?.[1]).toEqual(['Oncology'])
  })

  it('create rejects invalid names (400) and duplicates (409)', async () => {
    const res = await request(build())
      .post('/clinics')
      .set('Authorization', `Bearer ${managerToken()}`)
      .send({ name: 'x' })
    expect(res.status).toBe(400)

    query.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? '')
      if (sql.includes('SELECT id FROM clinics')) return { rows: [{ id: 9 }] } // name taken
      return { rows: [clinicRow()] }
    })
    const dup = await request(build())
      .post('/clinics')
      .set('Authorization', `Bearer ${managerToken()}`)
      .send({ name: 'radiology' })
    expect(dup.status).toBe(409)
  })

  it('manager renames a clinic (200) and rename conflicts are 409', async () => {
    installDb()
    const res = await request(build())
      .patch('/clinics/1')
      .set('Authorization', `Bearer ${managerToken()}`)
      .send({ name: 'Imaging' })
    expect(res.status).toBe(200)
    const update = query.mock.calls.find((c) => String(c[0]).includes('UPDATE clinics'))
    expect(update?.[1]).toEqual([1, 'Imaging', null])

    query.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? '')
      if (sql.includes('SELECT id FROM clinics')) return { rows: [{ id: 9 }] }
      return { rows: [clinicRow()] }
    })
    const conflict = await request(build())
      .patch('/clinics/1')
      .set('Authorization', `Bearer ${managerToken()}`)
      .send({ name: 'Cardiology' })
    expect(conflict.status).toBe(409)
  })

  it('manager deactivates a clinic (200)', async () => {
    installDb()
    const res = await request(build())
      .patch('/clinics/1')
      .set('Authorization', `Bearer ${managerToken()}`)
      .send({ isActive: false })
    expect(res.status).toBe(200)
    const update = query.mock.calls.find((c) => String(c[0]).includes('UPDATE clinics'))
    expect(update?.[1]).toEqual([1, null, false])
  })

  it('unknown clinic id is 404', async () => {
    query.mockResolvedValue({ rows: [] })
    const res = await request(build())
      .patch('/clinics/999')
      .set('Authorization', `Bearer ${managerToken()}`)
      .send({ name: 'Ghost' })
    expect(res.status).toBe(404)
  })

  it('administrator is forbidden from all clinic routes (403)', async () => {
    const app = build()
    const token = adminToken()
    expect((await request(app).get('/clinics').set('Authorization', `Bearer ${token}`)).status).toBe(403)
    expect(
      (await request(app).post('/clinics').set('Authorization', `Bearer ${token}`).send({ name: 'Xc' })).status,
    ).toBe(403)
    expect(
      (
        await request(app).patch('/clinics/1').set('Authorization', `Bearer ${token}`).send({
          name: 'Yc',
        })
      ).status,
    ).toBe(403)
  })

  it('doctor is forbidden from clinic routes (403)', async () => {
    const res = await request(build()).get('/clinics').set('Authorization', `Bearer ${doctorToken()}`)
    expect(res.status).toBe(403)
  })

  it('superadmin may manage clinics (200)', async () => {
    installDb()
    const res = await request(build())
      .get('/clinics')
      .set('Authorization', `Bearer ${superadminToken()}`)
    expect(res.status).toBe(200)
  })
})
