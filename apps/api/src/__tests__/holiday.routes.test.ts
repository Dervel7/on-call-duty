import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const list = vi.fn()
const create = vi.fn()
const update = vi.fn()
const remove = vi.fn()
vi.mock('../services/holiday.service', () => ({
  list: (...a: unknown[]) => list(...a),
  create: (...a: unknown[]) => create(...a),
  update: (...a: unknown[]) => update(...a),
  remove: (...a: unknown[]) => remove(...a),
}))

import { signAccessToken } from '../lib/jwt'
import { errorHandler } from '../middleware/error-handler'
import { holidayRouter } from '../routes/holiday.routes'

function build() {
  const app = express()
  app.use(express.json())
  app.use('/holidays', holidayRouter)
  app.use(errorHandler)
  return app
}

const adminToken = () => signAccessToken({ sub: 1, role: 'administrator' })
const doctorToken = () => signAccessToken({ sub: 10, role: 'doctor' })

const holiday = { id: 1, name: 'X', date: '2026-09-01', createdAt: '', updatedAt: '' }

beforeEach(() => {
  list.mockReset()
  create.mockReset()
  update.mockReset()
  remove.mockReset()
})

describe('holiday routes', () => {
  it('any authenticated user can list (200); unauthenticated is 401', async () => {
    list.mockResolvedValue([])
    const ok200 = await request(build())
      .get('/holidays')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(ok200.status).toBe(200)
    expect(ok200.body.data.holidays).toEqual([])

    const unauth = await request(build()).get('/holidays')
    expect(unauth.status).toBe(401)
  })

  it('admin creates (201); doctor mutate is 403', async () => {
    create.mockResolvedValue(holiday)
    const res = await request(build())
      .post('/holidays')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'X', date: '2026-09-01' })
    expect(res.status).toBe(201)

    const forbidden = await request(build())
      .post('/holidays')
      .set('Authorization', `Bearer ${doctorToken()}`)
      .send({ name: 'X', date: '2026-09-01' })
    expect(forbidden.status).toBe(403)
  })

  it('admin update (200), delete (204); bad id is 400', async () => {
    update.mockResolvedValue(holiday)
    remove.mockResolvedValue(undefined)
    const u = await request(build())
      .patch('/holidays/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Y' })
    expect(u.status).toBe(200)
    const d = await request(build())
      .delete('/holidays/1')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(d.status).toBe(204)
    const bad = await request(build())
      .patch('/holidays/abc')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ name: 'Y' })
    expect(bad.status).toBe(400)
  })
})
