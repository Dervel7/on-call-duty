import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const generate = vi.fn()
const list = vi.fn()
const getById = vi.fn()
const remove = vi.fn()
const addDuty = vi.fn()
const reassignDuty = vi.fn()
const removeDuty = vi.fn()
const publish = vi.fn()
const unpublish = vi.fn()
const generateOptions = vi.fn()
const generateAlternative = vi.fn()
vi.mock('../services/schedule-options.service.ts', () => ({
  generateOptions: (...a: unknown[]) => generateOptions(...a),
  generateAlternative: (...a: unknown[]) => generateAlternative(...a),
}))
vi.mock('../services/duty.service.ts', () => ({
  addDuty: (...a: unknown[]) => addDuty(...a),
  reassignDuty: (...a: unknown[]) => reassignDuty(...a),
  removeDuty: (...a: unknown[]) => removeDuty(...a),
}))
vi.mock('../services/schedule.service.ts', () => ({
  generate: (...a: unknown[]) => generate(...a),
  list: (...a: unknown[]) => list(...a),
  getById: (...a: unknown[]) => getById(...a),
  remove: (...a: unknown[]) => remove(...a),
  publish: (...a: unknown[]) => publish(...a),
  unpublish: (...a: unknown[]) => unpublish(...a),
}))
vi.mock('../services/billing.service.ts', () => ({ isLocked: async () => false }))
// The superadmin scope default resolves the sole clinic through the db pool.
const query = vi.fn()
vi.mock('../db/client.ts', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))



import { signAccessToken } from '../lib/jwt.ts'
import { HttpError } from '../lib/http-error.ts'
import { errorHandler } from '../middleware/error-handler.ts'
import { dutyRouter, scheduleRouter } from '../routes/schedule.routes.ts'

function build() {
  const app = express()
  app.use(express.json())
  app.use('/schedules', scheduleRouter)
  app.use('/duties', dutyRouter)
  app.use(errorHandler)
  return app
}

const adminToken = () => signAccessToken({ sub: 1, role: 'administrator', clinicId: 1 })
const doctorToken = () => signAccessToken({ sub: 10, role: 'doctor', clinicId: 10 })

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
  reason: 'manual override by admin #1',
  createdAt: '',
})

beforeEach(() => {
  [generateOptions, generateAlternative, generate, list, getById, remove, addDuty, reassignDuty, removeDuty, publish, unpublish].forEach((m) =>
    m.mockReset(),
  )
  query.mockReset()
})

const planBody = { year: 2026, month: 9, assignments: [{ date: '2026-09-01', doctorId: 5 }] }

describe('schedule routes', () => {
  it('unauthenticated is 401; doctors can read GET routes', async () => {
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

  it('options is admin-only (doctor 403); admin gets 200 with options', async () => {
    const forbidden = await request(build())
      .post('/schedules/options')
      .set('Authorization', `Bearer ${doctorToken()}`)
      .send({ year: 2026, month: 9 })
    expect(forbidden.status).toBe(403)
    expect(generateOptions).not.toHaveBeenCalled()

    generateOptions.mockResolvedValue({ year: 2026, month: 9, options: [] })
    const res = await request(build())
      .post('/schedules/options')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ year: 2026, month: 9 })
    expect(res.status).toBe(200)
    expect(res.body.data.options).toEqual([])
    expect(generateOptions).toHaveBeenCalledWith(2026, 9, expect.objectContaining({ clinicId: 1 }))
  })

  it('options returns 429 with Retry-After while the solver is busy', async () => {
    generateOptions.mockRejectedValue(new HttpError(429, 'Solver busy, try again shortly', 10))
    const res = await request(build())
      .post('/schedules/options')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ year: 2026, month: 9 })
    expect(res.status).toBe(429)
    expect(res.headers['retry-after']).toBe('10')
    expect(res.body.error).toBe('Solver busy, try again shortly')
  })

  it('alternative is admin-only; admin gets 200; invalid index is 400', async () => {
    const forbidden = await request(build())
      .post('/schedules/options/alternative')
      .set('Authorization', `Bearer ${doctorToken()}`)
      .send({ year: 2026, month: 9, index: 2 })
    expect(forbidden.status).toBe(403)

    for (const index of [1, 4, undefined]) {
      const bad = await request(build())
        .post('/schedules/options/alternative')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ year: 2026, month: 9, index })
      expect(bad.status).toBe(400)
    }
    expect(generateAlternative).not.toHaveBeenCalled()

    generateAlternative.mockResolvedValue({ option: null, moreAvailable: false })
    const res = await request(build())
      .post('/schedules/options/alternative')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ year: 2026, month: 9, index: 2 })
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ option: null, moreAvailable: false })
    expect(generateAlternative).toHaveBeenCalledWith(2026, 9, 2, expect.objectContaining({ clinicId: 1 }))
  })

  it('alternative returns 429 with Retry-After while the solver is busy', async () => {
    generateAlternative.mockRejectedValue(new HttpError(429, 'Solver busy, try again shortly', 10))
    const res = await request(build())
      .post('/schedules/options/alternative')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ year: 2026, month: 9, index: 2 })
    expect(res.status).toBe(429)
    expect(res.headers['retry-after']).toBe('10')
  })

  it('superadmin alternative resolves the clinic from the query', async () => {
    query.mockResolvedValue({ rows: [{ id: 1 }] })
    generateAlternative.mockResolvedValue({ option: null, moreAvailable: false })
    const token = signAccessToken({ sub: 2, role: 'superadmin', clinicId: null })
    const res = await request(build())
      .post('/schedules/options/alternative?clinicId=1')
      .set('Authorization', `Bearer ${token}`)
      .send({ year: 2026, month: 9, index: 3 })
    expect(res.status).toBe(200)
    expect(generateAlternative).toHaveBeenCalledWith(2026, 9, 3, expect.objectContaining({ clinicId: 1 }))
  })

  it('save needs a non-empty plan: 400 without assignments or with an empty array, and nothing is solved', async () => {
    for (const body of [{ year: 2026, month: 9 }, { year: 2026, month: 9, assignments: [] }]) {
      const res = await request(build()).post('/schedules').set('Authorization', `Bearer ${adminToken()}`).send(body)
      expect(res.status).toBe(400)
    }
    expect(generate).not.toHaveBeenCalled()
  })

  it('admin generate 201; 409 exists; 422 unfillable', async () => {
    generate.mockResolvedValue(detail())
    const ok201 = await request(build())
      .post('/schedules')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(planBody)
    expect(ok201.status).toBe(201)

    generate.mockRejectedValue(Object.assign(new Error('exists'), { status: 409 }))
    const exists = await request(build())
      .post('/schedules')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(planBody)
    expect(exists.status).toBe(409)

    generate.mockRejectedValue(Object.assign(new Error('unfillable'), { status: 422 }))
    const unfillable = await request(build())
      .post('/schedules')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(planBody)
    expect(unfillable.status).toBe(422)
  })

  it('admin generate forwards an assignments plan to the service (201)', async () => {
    generate.mockResolvedValue(detail())
    const res = await request(build())
      .post('/schedules')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ year: 2026, month: 9, assignments: [{ date: '2026-09-01', doctorId: 5 }] })
    expect(res.status).toBe(201)
    expect(generate).toHaveBeenCalledWith(2026, 9, expect.anything(), expect.anything(), [
      { date: '2026-09-01', doctorId: 5 },
    ])
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

describe('clinic scoping on schedule routes', () => {
  const managerToken = () => signAccessToken({ sub: 5, role: 'manager', clinicId: null })
  const superadminToken = () => signAccessToken({ sub: 2, role: 'superadmin', clinicId: null })

  it('manager reads list with clinicId (200); 400 without', async () => {
    list.mockResolvedValue([])
    const ok = await request(build())
      .get('/schedules?clinicId=1')
      .set('Authorization', `Bearer ${managerToken()}`)
    expect(ok.status).toBe(200)
    const missing = await request(build()).get('/schedules').set('Authorization', `Bearer ${managerToken()}`)
    expect(missing.status).toBe(400)
  })

  it('manager is 403 on every write route (I14)', async () => {
    const token = managerToken()
    const app = build()
    expect(
      (await request(app).post('/schedules?clinicId=1').set('Authorization', `Bearer ${token}`).send(planBody)).status,
    ).toBe(403)
    expect(
      (await request(app).post('/schedules/1/publish').set('Authorization', `Bearer ${token}`)).status,
    ).toBe(403)
    expect(
      (await request(app).post('/schedules/1/duties').set('Authorization', `Bearer ${token}`).send({ date: '2026-09-05', doctorId: 5 })).status,
    ).toBe(403)
    expect(
      (await request(app).patch('/duties/1').set('Authorization', `Bearer ${token}`).send({ doctorId: 5 })).status,
    ).toBe(403)
  })

  it('superadmin generate without clinicId defaults to the sole clinic', async () => {
    query.mockResolvedValue({ rows: [{ id: 1 }] })
    generate.mockResolvedValue(detail())
    const token = superadminToken()
    const app = build()
    expect(
      (await request(app).post('/schedules').set('Authorization', `Bearer ${token}`).send(planBody)).status,
    ).toBe(201)
    expect(generate).toHaveBeenCalledWith(
      2026,
      9,
      expect.anything(),
      expect.objectContaining({ clinicId: 1 }),
      planBody.assignments,
    )
  })

  it('superadmin options without clinicId defaults to the sole clinic', async () => {
    query.mockResolvedValue({ rows: [{ id: 1 }] })
    generateOptions.mockResolvedValue({ year: 2026, month: 9, options: [] })
    const res = await request(build())
      .post('/schedules/options')
      .set('Authorization', `Bearer ${superadminToken()}`)
      .send({ year: 2026, month: 9 })
    expect(res.status).toBe(200)
    expect(generateOptions).toHaveBeenCalledWith(2026, 9, expect.objectContaining({ clinicId: 1 }))
  })

  it('administrator generate without clinicId resolves to own clinic', async () => {
    generate.mockResolvedValue(detail())
    const res = await request(build())
      .post('/schedules')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send(planBody)
    expect(res.status).toBe(201)
    expect(generate).toHaveBeenCalledWith(
      2026,
      9,
      expect.anything(),
      expect.objectContaining({ clinicId: 1 }),
      planBody.assignments,
    )
  })
})
