import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const preview = vi.fn()
const generate = vi.fn()
const list = vi.fn()
const getById = vi.fn()
const remove = vi.fn()
const addDuty = vi.fn()
const reassignDuty = vi.fn()
const removeDuty = vi.fn()
const publish = vi.fn()
const unpublish = vi.fn()
vi.mock('../services/schedule.service', () => ({
  preview: (...a: unknown[]) => preview(...a),
  generate: (...a: unknown[]) => generate(...a),
  list: (...a: unknown[]) => list(...a),
  getById: (...a: unknown[]) => getById(...a),
  remove: (...a: unknown[]) => remove(...a),
  addDuty: (...a: unknown[]) => addDuty(...a),
  reassignDuty: (...a: unknown[]) => reassignDuty(...a),
  removeDuty: (...a: unknown[]) => removeDuty(...a),
  publish: (...a: unknown[]) => publish(...a),
  unpublish: (...a: unknown[]) => unpublish(...a),
}))

import { signAccessToken } from '../lib/jwt'
import { errorHandler } from '../middleware/error-handler'
import { dutyRouter, scheduleRouter } from '../routes/schedule.routes'

function build() {
  const app = express()
  app.use(express.json())
  app.use('/schedules', scheduleRouter)
  app.use('/duties', dutyRouter)
  app.use(errorHandler)
  return app
}

const adminToken = () => signAccessToken({ sub: 1, role: 'administrator' })
const doctorToken = () => signAccessToken({ sub: 10, role: 'doctor' })

const detail = () => ({
  schedule: {
    id: 1,
    year: 2026,
    month: 9,
    status: 'draft',
    createdBy: 1,
    createdAt: '',
    updatedAt: '',
  },
  duties: [],
  days: [],
})
const duty = (id: number, doctorId: number) => ({
  id,
  scheduleId: 1,
  dutyDate: '2026-09-05',
  doctorId,
  doctorFirstName: 'A',
  doctorLastName: 'B',
  isWeekend: false,
  isHoliday: false,
  reason: 'manual override by admin #1',
  createdAt: '',
})

beforeEach(() => {
  [preview, generate, list, getById, remove, addDuty, reassignDuty, removeDuty, publish, unpublish].forEach((m) =>
    m.mockReset(),
  )
})

describe('schedule routes', () => {
  it('preview stays admin-only (doctor 403); unauthenticated is 401; doctors can read GET routes', async () => {
    const forbidden = await request(build())
      .post('/schedules/preview')
      .set('Authorization', `Bearer ${doctorToken()}`)
      .send({ year: 2026, month: 9 })
    expect(forbidden.status).toBe(403)

    const unauth = await request(build()).get('/schedules')
    expect(unauth.status).toBe(401)

    list.mockResolvedValue([])
    const doctorList = await request(build())
      .get('/schedules')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(doctorList.status).toBe(200)

    getById.mockResolvedValue(detail())
    const doctorDetail = await request(build())
      .get('/schedules/1')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(doctorDetail.status).toBe(200)
  })

  it('admin preview returns 200 with assignments + conflicts', async () => {
    preview.mockResolvedValue({ assignments: [], conflicts: [] })
    const res = await request(build())
      .post('/schedules/preview')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ year: 2026, month: 9 })
    expect(res.status).toBe(200)
    expect(res.body.data.assignments).toEqual([])
    expect(res.body.data.conflicts).toEqual([])
  })

  it('admin generate 201; 409 exists; 422 unfillable', async () => {
    generate.mockResolvedValue(detail())
    const ok201 = await request(build())
      .post('/schedules')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ year: 2026, month: 9 })
    expect(ok201.status).toBe(201)

    generate.mockRejectedValue(Object.assign(new Error('exists'), { status: 409 }))
    const exists = await request(build())
      .post('/schedules')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ year: 2026, month: 9 })
    expect(exists.status).toBe(409)

    generate.mockRejectedValue(Object.assign(new Error('unfillable'), { status: 422 }))
    const unfillable = await request(build())
      .post('/schedules')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ year: 2026, month: 9 })
    expect(unfillable.status).toBe(422)
  })

  it('admin list (200), getById (200), delete (204)', async () => {
    list.mockResolvedValue([])
    getById.mockResolvedValue(detail())
    remove.mockResolvedValue(undefined)
    const l = await request(build())
      .get('/schedules')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(l.status).toBe(200)
    const g = await request(build())
      .get('/schedules/1')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(g.status).toBe(200)
    expect(g.body.data.schedule.id).toBe(1)
    const d = await request(build())
      .delete('/schedules/1')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(d.status).toBe(204)
  })

  it('admin add duty (201); reassign (200); remove duty (204)', async () => {
    addDuty.mockResolvedValue(duty(5, 3))
    reassignDuty.mockResolvedValue(duty(5, 4))
    removeDuty.mockResolvedValue(undefined)

    const a = await request(build())
      .post('/schedules/1/duties')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ date: '2026-09-05', doctorId: 3 })
    expect(a.status).toBe(201)

    const p = await request(build())
      .patch('/duties/5')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ doctorId: 4 })
    expect(p.status).toBe(200)

    const r = await request(build())
      .delete('/duties/5')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(r.status).toBe(204)
  })

  it('admin publish (200) and unpublish (200); doctor 403', async () => {
    publish.mockResolvedValue({
      id: 1, year: 2026, month: 9, status: 'published', createdBy: 1, createdAt: '', updatedAt: '',
    })
    unpublish.mockResolvedValue({
      id: 1, year: 2026, month: 9, status: 'draft', createdBy: 1, createdAt: '', updatedAt: '',
    })
    const p = await request(build())
      .post('/schedules/1/publish')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(p.status).toBe(200)
    expect(p.body.data.schedule.status).toBe('published')

    const u = await request(build())
      .post('/schedules/1/unpublish')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(u.status).toBe(200)
    expect(u.body.data.schedule.status).toBe('draft')

    const forbidden = await request(build())
      .post('/schedules/1/publish')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(forbidden.status).toBe(403)
  })

  it('duty + schedule mutations surface the published-lock as 409', async () => {
    const locked = Object.assign(new Error('Schedule is published; revert to draft to edit'), { status: 409 })
    addDuty.mockRejectedValue(locked)
    reassignDuty.mockRejectedValue(locked)
    removeDuty.mockRejectedValue(locked)
    remove.mockRejectedValue(locked)

    const a = await request(build())
      .post('/schedules/1/duties')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ date: '2026-09-05', doctorId: 3 })
    expect(a.status).toBe(409)
    const r = await request(build())
      .patch('/duties/5')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ doctorId: 4 })
    expect(r.status).toBe(409)
    const d = await request(build())
      .delete('/duties/5')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(d.status).toBe(409)
    const s = await request(build())
      .delete('/schedules/1')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(s.status).toBe(409)
  })
})
