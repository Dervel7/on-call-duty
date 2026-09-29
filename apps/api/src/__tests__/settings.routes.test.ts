import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getOpenDutySettings = vi.fn()
const setOpenDutyInterval = vi.fn()
vi.mock('../services/settings.service', () => ({
  getOpenDutySettings: (...a: unknown[]) => getOpenDutySettings(...a),
  setOpenDutyInterval: (...a: unknown[]) => setOpenDutyInterval(...a),
}))
vi.mock('../services/billing.service', () => ({ isLocked: async () => false }))

import { signAccessToken } from '../lib/jwt'
import { errorHandler } from '../middleware/error-handler'
import { settingsRouter } from '../routes/settings.routes'

function build() {
  const app = express()
  app.use(express.json())
  app.use('/settings', settingsRouter)
  app.use(errorHandler)
  return app
}

const adminToken = () => signAccessToken({ sub: 1, role: 'administrator', clinicId: 1 })
const superadminToken = () => signAccessToken({ sub: 2, role: 'superadmin', clinicId: null })
const doctorToken = () => signAccessToken({ sub: 10, role: 'doctor', clinicId: 10 })

beforeEach(() => {
  getOpenDutySettings.mockReset()
  setOpenDutyInterval.mockReset()
})

describe('settings routes', () => {
  it('GET /settings/open-duty: 401 unauthenticated, 403 doctor, 200 admin with the cycle', async () => {
    expect((await request(build()).get('/settings/open-duty')).status).toBe(401)

    const forbidden = await request(build())
      .get('/settings/open-duty')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(forbidden.status).toBe(403)

    getOpenDutySettings.mockResolvedValue({ anchorDate: '2026-10-02', intervalDays: 8 })
    const res = await request(build())
      .get('/settings/open-duty')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.data.openDuty).toEqual({ anchorDate: '2026-10-02', intervalDays: 8 })
  })

  it('PATCH rejects doctors (403) and invalid intervals (400) without touching the service', async () => {
    const forbidden = await request(build())
      .patch('/settings/open-duty')
      .set('Authorization', `Bearer ${doctorToken()}`)
      .send({ intervalDays: 8 })
    expect(forbidden.status).toBe(403)

    for (const intervalDays of [0, -1, 1.5, 366, 'abc']) {
      const res = await request(build())
        .patch('/settings/open-duty')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ intervalDays })
      expect(res.status).toBe(400)
    }
    expect(setOpenDutyInterval).not.toHaveBeenCalled()
  })

  it('PATCH saves for administrators and superadmins, echoing the updated cycle', async () => {
    setOpenDutyInterval.mockResolvedValue({ anchorDate: '2026-10-02', intervalDays: 14 })

    const res = await request(build())
      .patch('/settings/open-duty')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ intervalDays: 14 })
    expect(res.status).toBe(200)
    expect(res.body.data.openDuty).toEqual({ anchorDate: '2026-10-02', intervalDays: 14 })
    expect(setOpenDutyInterval).toHaveBeenCalledWith(
      { intervalDays: 14 },
      expect.objectContaining({ id: 1, role: 'administrator' }),
    )

    const asString = await request(build())
      .patch('/settings/open-duty')
      .set('Authorization', `Bearer ${superadminToken()}`)
      .send({ intervalDays: '14' })
    expect(asString.status).toBe(200)
  })
})
