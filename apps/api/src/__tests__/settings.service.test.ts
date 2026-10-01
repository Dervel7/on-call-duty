import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

const logActivity = vi.fn()
const recordActivity = vi.fn()
vi.mock('../services/activity.service', () => ({
  logActivity: (...a: unknown[]) => logActivity(...a),
  recordActivity: (...a: unknown[]) => recordActivity(...a),
}))

import {
  getClinicDutySlots,
  getDutySlots,
  getOpenDutySettings,
  setOpenDutyInterval,
  setDutySlots,
} from '../services/settings.service'

beforeEach(() => {
  query.mockReset()
  logActivity.mockReset()
  recordActivity.mockReset()
})

describe('settings.service', () => {
  it('missing app_meta rows fall back to the seeded defaults', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(getOpenDutySettings()).resolves.toEqual({
      anchorDate: '2026-10-02',
      intervalDays: 8,
    })
  })

  it('reads the stored cycle rows', async () => {
    query.mockResolvedValue({
      rows: [
        { key: 'open_duty_anchor_date', value: '2026-10-02' },
        { key: 'open_duty_interval_days', value: '14' },
      ],
    })
    await expect(getOpenDutySettings()).resolves.toEqual({
      anchorDate: '2026-10-02',
      intervalDays: 14,
    })
  })

  it('corrupt rows fall back to the defaults instead of breaking scheduling', async () => {
    query.mockResolvedValue({
      rows: [
        { key: 'open_duty_anchor_date', value: 'not-a-date' },
        { key: 'open_duty_interval_days', value: 'zero' },
      ],
    })
    await expect(getOpenDutySettings()).resolves.toEqual({
      anchorDate: '2026-10-02',
      intervalDays: 8,
    })
  })

  it('setOpenDutyInterval upserts, audits open_duty_settings.updated, returns fresh settings', async () => {
    const appMeta = new Map<string, string>([['open_duty_interval_days', '8']])
    query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('INSERT INTO app_meta')) {
        appMeta.set(String(params[0]), String(params[1]))
        return { rows: [] }
      }
      const rows: Array<{ key: string; value: string }> = []
      for (const key of params.map(String)) {
        const value = appMeta.get(key)
        if (value !== undefined) rows.push({ key, value })
      }
      return { rows }
    })

    const settings = await setOpenDutyInterval({ intervalDays: 14 }, { id: 1, role: 'administrator' })
    expect(settings).toEqual({ anchorDate: '2026-10-02', intervalDays: 14 })
    const upsert = query.mock.calls.find((c) => String(c[0]).includes('ON CONFLICT'))
    expect(upsert?.[1]).toEqual(['open_duty_interval_days', '14'])
    expect(logActivity).toHaveBeenCalledWith({
      userId: 1,
      action: 'open_duty_settings.updated',
      entityType: 'open_duty_settings',
      entityId: null,
      detail: { previousIntervalDays: 8, intervalDays: 14 },
    })
  })
})

describe('settings.service duty slots', () => {
  const clinicRow = (open: number, closed: number, activeDoctors: number) => ({
    open_duty_slots: open,
    closed_duty_slots: closed,
    active_doctors: activeDoctors,
  })

  it('reads the clinic slot counts and active doctor count', async () => {
    query.mockResolvedValue({ rows: [clinicRow(3, 1, 30)] })
    await expect(getClinicDutySlots(4)).resolves.toEqual({
      openDutySlots: 3,
      closedDutySlots: 1,
      activeDoctors: 30,
    })
    expect(query.mock.calls[0]?.[1]).toEqual([4])
  })

  it('an unknown clinic is 404', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(getDutySlots(99)).rejects.toMatchObject({ status: 404 })
    await expect(getClinicDutySlots(99)).rejects.toMatchObject({ status: 404 })
  })

  it('setDutySlots accepts counts up to the active doctor count (above the old 7 ceiling)', async () => {
    let stored = clinicRow(2, 2, 30)
    query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('UPDATE clinics')) {
        stored = clinicRow(Number(params[1]), Number(params[2]), stored.active_doctors)
        return { rows: [] }
      }
      return { rows: [stored] }
    })

    const settings = await setDutySlots(
      { openDutySlots: 30, closedDutySlots: 10 },
      { id: 1, role: 'administrator' },
      4,
    )
    expect(settings).toEqual({ openDutySlots: 30, closedDutySlots: 10, activeDoctors: 30 })
    const update = query.mock.calls.find((c) => String(c[0]).includes('UPDATE clinics'))
    expect(update?.[1]).toEqual([4, 30, 10])
    expect(logActivity).toHaveBeenCalledWith({
      userId: 1,
      action: 'duty_slots_settings.updated',
      entityType: 'duty_slots_settings',
      entityId: null,
      clinicId: 4,
      detail: {
        previousOpenDutySlots: 2,
        previousClosedDutySlots: 2,
        openDutySlots: 30,
        closedDutySlots: 10,
      },
    })
  })

  it('setDutySlots rejects either count above the active doctor count (422) without writing', async () => {
    query.mockResolvedValue({ rows: [clinicRow(2, 2, 5)] })
    for (const input of [
      { openDutySlots: 6, closedDutySlots: 2 },
      { openDutySlots: 2, closedDutySlots: 6 },
    ]) {
      await expect(
        setDutySlots(input, { id: 1, role: 'administrator' }, 4),
      ).rejects.toMatchObject({ status: 422 })
    }
    expect(query.mock.calls.some((c) => String(c[0]).includes('UPDATE clinics'))).toBe(false)
    expect(logActivity).not.toHaveBeenCalled()
  })
})
