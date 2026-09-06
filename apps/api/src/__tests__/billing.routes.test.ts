import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const isLocked = vi.fn()
const getState = vi.fn()
const setPaidThrough = vi.fn()
const getPaymentAlert = vi.fn()
vi.mock('../services/billing.service', () => ({
  isLocked: (...a: unknown[]) => isLocked(...a),
  getState: (...a: unknown[]) => getState(...a),
  setPaidThrough: (...a: unknown[]) => setPaidThrough(...a),
  getPaymentAlert: (...a: unknown[]) => getPaymentAlert(...a),
}))

import { signAccessToken } from '../lib/jwt'
import { errorHandler } from '../middleware/error-handler'
import { billingRouter } from '../routes/billing.routes'

function build() {
  const app = express()
  app.use(express.json())
  app.use('/billing', billingRouter)
  app.use(errorHandler)
  return app
}

const superadminToken = () => signAccessToken({ sub: 1, role: 'superadmin' })
const doctorToken = () => signAccessToken({ sub: 10, role: 'doctor' })
const administratorToken = () => signAccessToken({ sub: 2, role: 'administrator' })

beforeEach(() => {
  isLocked.mockReset()
  isLocked.mockResolvedValue(false)
  getState.mockReset()
  setPaidThrough.mockReset()
  getPaymentAlert.mockReset()
})

describe('billing routes', () => {
  it('unauthenticated requests are 401 on both verbs', async () => {
    expect((await request(build()).get('/billing')).status).toBe(401)
    expect((await request(build()).patch('/billing').send({ paidThrough: '2026-12-31' })).status).toBe(401)
  })

  it('non-superadmin is 403 on both verbs (even administrators)', async () => {
    const get = await request(build()).get('/billing').set('Authorization', `Bearer ${doctorToken()}`)
    expect(get.status).toBe(403)
    expect(get.body.error).toBe('Forbidden')

    const patch = await request(build())
      .patch('/billing')
      .set('Authorization', `Bearer ${administratorToken()}`)
      .send({ paidThrough: '2026-12-31' })
    expect(patch.status).toBe(403)
    expect(patch.body.error).toBe('Forbidden')
  })

  it('superadmin gets state (200) and updates paidThrough (200)', async () => {
    getState.mockResolvedValue({ paidThrough: null, locked: false })
    setPaidThrough.mockResolvedValue({ paidThrough: '2026-12-31', locked: false })

    const get = await request(build()).get('/billing').set('Authorization', `Bearer ${superadminToken()}`)
    expect(get.status).toBe(200)
    expect(get.body.data.billing).toEqual({ paidThrough: null, locked: false })

    const patch = await request(build())
      .patch('/billing')
      .set('Authorization', `Bearer ${superadminToken()}`)
      .send({ paidThrough: '2026-12-31' })
    expect(patch.status).toBe(200)
    expect(patch.body.data.billing).toEqual({ paidThrough: '2026-12-31', locked: false })
    expect(setPaidThrough).toHaveBeenCalledWith(
      { paidThrough: '2026-12-31' },
      { id: 1, role: 'superadmin' },
    )
  })

  it('invalid paidThrough is 400 (malformed and calendar-invalid)', async () => {
    const app = build()
    const malformed = await request(app)
      .patch('/billing')
      .set('Authorization', `Bearer ${superadminToken()}`)
      .send({ paidThrough: 'oops' })
    expect(malformed.status).toBe(400)

    const impossible = await request(app)
      .patch('/billing')
      .set('Authorization', `Bearer ${superadminToken()}`)
      .send({ paidThrough: '2026-02-30' })
    expect(impossible.status).toBe(400)
    expect(setPaidThrough).not.toHaveBeenCalled()
  })

  it('payment-alert: administrator reads it (200), doctor is 403', async () => {
    getPaymentAlert.mockResolvedValue({ daysLeft: 3 })
    const res = await request(build())
      .get('/billing/payment-alert')
      .set('Authorization', `Bearer ${administratorToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.data.paymentAlert).toEqual({ daysLeft: 3 })
    expect(getPaymentAlert).toHaveBeenCalledTimes(1)

    const denied = await request(build())
      .get('/billing/payment-alert')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(denied.status).toBe(403)
    expect(denied.body.error).toBe('Forbidden')
  })
})
