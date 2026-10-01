import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getOpenDutySettings = vi.fn()
const setOpenDutyInterval = vi.fn()
const getClinicDutySlots = vi.fn()
const setDutySlots = vi.fn()
vi.mock('../services/settings.service', () => ({
  getOpenDutySettings: (...a: unknown[]) => getOpenDutySettings(...a),
  setOpenDutyInterval: (...a: unknown[]) => setOpenDutyInterval(...a),
  getClinicDutySlots: (...a: unknown[]) => getClinicDutySlots(...a),
  setDutySlots: (...a: unknown[]) => setDutySlots(...a),
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
  getClinicDutySlots.mockReset()
  setDutySlots.mockReset()
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

describe('duty-slots settings routes', () => {
  const slots = { openDutySlots: 2, closedDutySlots: 2, activeDoctors: 30 }

  it('GET /settings/duty-slots: 401 unauthenticated, 403 doctor, 200 admin with own-clinic counts', async () => {
    expect((await request(build()).get('/settings/duty-slots')).status).toBe(401)

    const forbidden = await request(build())
      .get('/settings/duty-slots')
      .set('Authorization', `Bearer ${doctorToken()}`)
    expect(forbidden.status).toBe(403)

    getClinicDutySlots.mockResolvedValue(slots)
    const res = await request(build())
      .get('/settings/duty-slots')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.data.dutySlots).toEqual(slots)
    expect(getClinicDutySlots).toHaveBeenCalledWith(1)
  })

  it("an administrator cannot read or change another clinic's slots (403)", async () => {
    const read = await request(build())
      .get('/settings/duty-slots?clinicId=2')
      .set('Authorization', `Bearer ${adminToken()}`)
    expect(read.status).toBe(403)
    const write = await request(build())
      .patch('/settings/duty-slots?clinicId=2')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ openDutySlots: 3, closedDutySlots: 2 })
    expect(write.status).toBe(403)
    expect(getClinicDutySlots).not.toHaveBeenCalled()
    expect(setDutySlots).not.toHaveBeenCalled()
  })

  it('PATCH rejects doctors (403) and malformed counts (400) without touching the service', async () => {
    const forbidden = await request(build())
      .patch('/settings/duty-slots')
      .set('Authorization', `Bearer ${doctorToken()}`)
      .send({ openDutySlots: 3, closedDutySlots: 2 })
    expect(forbidden.status).toBe(403)

    for (const body of [
      { openDutySlots: 0, closedDutySlots: 2 },
      { openDutySlots: 1.5, closedDutySlots: 2 },
      { openDutySlots: 2 },
      { openDutySlots: 'abc', closedDutySlots: 2 },
    ]) {
      const res = await request(build())
        .patch('/settings/duty-slots')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send(body)
      expect(res.status).toBe(400)
    }
    expect(setDutySlots).not.toHaveBeenCalled()
  })

  it('PATCH saves own-clinic counts for administrators and the named clinic for superadmins', async () => {
    setDutySlots.mockResolvedValue({ openDutySlots: 10, closedDutySlots: 8, activeDoctors: 30 })

    const res = await request(build())
      .patch('/settings/duty-slots')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ openDutySlots: 10, closedDutySlots: 8 })
    expect(res.status).toBe(200)
    expect(res.body.data.dutySlots).toEqual({ openDutySlots: 10, closedDutySlots: 8, activeDoctors: 30 })
    expect(setDutySlots).toHaveBeenCalledWith(
      { openDutySlots: 10, closedDutySlots: 8 },
      expect.objectContaining({ id: 1, role: 'administrator' }),
      1,
    )

    const asString = await request(build())
      .patch('/settings/duty-slots?clinicId=3')
      .set('Authorization', `Bearer ${superadminToken()}`)
      .send({ openDutySlots: '3', closedDutySlots: '1' })
    expect(asString.status).toBe(200)
    expect(setDutySlots).toHaveBeenLastCalledWith(
      { openDutySlots: 3, closedDutySlots: 1 },
      expect.objectContaining({ id: 2, role: 'superadmin' }),
      3,
    )
  })
})
