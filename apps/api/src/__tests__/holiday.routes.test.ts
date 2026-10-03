import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))
// authenticate consults the billing lock on every request; route tests stub it unlocked.
vi.mock('../services/billing.service', () => ({ isLocked: async () => false }))

const logActivity = vi.fn()
const recordActivity = vi.fn()
vi.mock('../services/activity.service', () => ({
  logActivity: (...a: unknown[]) => logActivity(...a),
  recordActivity: (...a: unknown[]) => recordActivity(...a),
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

const adminToken = () => signAccessToken({ sub: 1, role: 'administrator', clinicId: 1 })
const superadminToken = () => signAccessToken({ sub: 2, role: 'superadmin', clinicId: null })
const doctorToken = () => signAccessToken({ sub: 10, role: 'doctor', clinicId: 10 })

const row = () => ({
  id: 1,
  clinic_id: 1,
  holiday_date: '2026-01-01',
})

beforeEach(() => {
  query.mockReset()
  logActivity.mockReset()
  recordActivity.mockReset()
})

describe('holiday routes', () => {
  it('admin lists a year (200) with clinic + year in the SQL params', async () => {
    query.mockResolvedValue({ rows: [row()] })
    const res = await request(build())
      .get('/holidays?year=2026')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.data.holidays).toEqual([{ id: 1, clinicId: 1, date: '2026-01-01' }])
    expect(query.mock.calls[0]?.[1]).toEqual([1, 2026])
  })

  it('doctor is forbidden (403)', async () => {
    const res = await request(build())
      .get('/holidays?year=2026')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(res.status).toBe(403)
  })

  it('missing year is 400', async () => {
    const res = await request(build())
      .get('/holidays')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(400)
  })

  it('superadmin defaults to the sole clinic; explicit clinicId drill-down', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] }) // sole-clinic scope lookup
    query.mockResolvedValue({ rows: [row()] })
    const defaulted = await request(build())
      .get('/holidays?year=2026')
      .set('Authorization', `Bearer ${superadminToken()}`)
    expect(defaulted.status).toBe(200)
    expect(query.mock.calls[0]?.[0]).toContain('FROM clinics')
    expect(query.mock.calls[1]?.[1]).toEqual([1, 2026])

    query.mockResolvedValue({ rows: [] })
    const okRes = await request(build())
      .get('/holidays?year=2026&clinicId=3')
      .set('Authorization', `Bearer ${superadminToken()}`)
    expect(okRes.status).toBe(200)
    expect(query.mock.calls[2]?.[1]).toEqual([3, 2026])
  })


  it('admin replaces a month (200): DELETE + INSERT inside the transaction, audited', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] }) // clinic exists
    query.mockResolvedValueOnce({ rows: [] }) // DELETE
    query.mockResolvedValueOnce({ rows: [] }) // INSERT
    query.mockResolvedValue({ rows: [{ id: 7, clinic_id: 1, holiday_date: '2026-03-25' }] })
    const res = await request(build())
      .put('/holidays/month')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ year: 2026, month: 3, dates: ['2026-03-25'] })
    expect(res.status).toBe(200)
    expect(res.body.data.holidays).toEqual([{ id: 7, clinicId: 1, date: '2026-03-25' }])

    const sql = query.mock.calls.map((c) => c[0]).join('\n')
    expect(sql).toContain('DELETE FROM holidays')
    expect(sql).toContain('INSERT INTO holidays')
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM holidays'),
      [1, 2026, 3],
    )
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO holidays'),
      [1, '2026-03-25'],
    )
    expect(recordActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'holidays.updated', entityType: 'holidays' }),
    )
  })

  it('PUT with a date outside the month is 400 (schema refine)', async () => {
    const res = await request(build())
      .put('/holidays/month')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ year: 2026, month: 3, dates: ['2026-04-01'] })
    expect(res.status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })

  it('superadmin PUT defaults to the sole clinic', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] }) // sole-clinic scope lookup
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] }) // clinic exists
    query.mockResolvedValueOnce({ rows: [] }) // DELETE
    query.mockResolvedValueOnce({ rows: [] }) // INSERT
    query.mockResolvedValue({ rows: [{ id: 7, clinic_id: 1, holiday_date: '2026-03-25' }] })
    const res = await request(build())
      .put('/holidays/month')
      .set('Authorization', `Bearer ${superadminToken()}`)
      .send({ year: 2026, month: 3, dates: ['2026-03-25'] })
    expect(res.status).toBe(200)
    expect(res.body.data.holidays).toEqual([{ id: 7, clinicId: 1, date: '2026-03-25' }])
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM holidays'),
      [1, 2026, 3],
    )
  })

  it('PUT parses ?clinicId= as a number: admin naming its own clinic is 200', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] }) // clinic exists
    query.mockResolvedValue({ rows: [] })
    const res = await request(build())
      .put('/holidays/month?clinicId=1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ year: 2026, month: 3, dates: [] })
    expect(res.status).toBe(200)
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM holidays'),
      [1, 2026, 3],
    )
  })

  it('PUT with a non-numeric ?clinicId= is 400 before any SQL', async () => {
    const res = await request(build())
      .put('/holidays/month?clinicId=abc')
      .set('Authorization', `Bearer ${superadminToken()}`)
      .send({ year: 2026, month: 3, dates: [] })
    expect(res.status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })

  it('superadmin PUT for an unknown clinic is 404 and writes nothing', async () => {
    query.mockResolvedValueOnce({ rows: [] }) // clinic lookup
    const res = await request(build())
      .put('/holidays/month?clinicId=999')
      .set('Authorization', `Bearer ${superadminToken()}`)
      .send({ year: 2026, month: 3, dates: ['2026-03-25'] })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Clinic not found')
    expect(query).toHaveBeenCalledTimes(1)
    expect(recordActivity).not.toHaveBeenCalled()
  })

  it('clinicId above INTEGER is 400 before any SQL (GET and PUT)', async () => {
    const get = await request(build())
      .get('/holidays?year=2026&clinicId=3000000000')
      .set('Authorization', `Bearer ${superadminToken()}`)
    expect(get.status).toBe(400)
    const put = await request(build())
      .put('/holidays/month?clinicId=3000000000')
      .set('Authorization', `Bearer ${superadminToken()}`)
      .send({ year: 2026, month: 3, dates: [] })
    expect(put.status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })
})
