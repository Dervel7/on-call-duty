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
  getDutyMinimums,
  getDutySlots,
  getOpenDutySettings,
  setDutyMinimums,
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
  it('missing app_meta rows fall back to the seeded 2/2 defaults', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(getDutySlots()).resolves.toEqual({
      openDutySlots: 2,
      closedDutySlots: 2,
    })
  })

  it('reads the stored slot rows', async () => {
    query.mockResolvedValue({
      rows: [
        { key: 'open_duty_slots', value: '3' },
        { key: 'closed_duty_slots', value: '1' },
      ],
    })
    await expect(getDutySlots()).resolves.toEqual({
      openDutySlots: 3,
      closedDutySlots: 1,
    })
  })

  it('corrupt rows fall back to the defaults instead of breaking scheduling', async () => {
    query.mockResolvedValue({
      rows: [
        { key: 'open_duty_slots', value: 'three' },
        { key: 'closed_duty_slots', value: '0' },
      ],
    })
    await expect(getDutySlots()).resolves.toEqual({
      openDutySlots: 2,
      closedDutySlots: 2,
    })
  })

  it('setDutySlots upserts both keys, audits duty_slots_settings.updated, returns fresh settings', async () => {
    const appMeta = new Map<string, string>()
    query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('INSERT INTO app_meta')) {
        appMeta.set(String(params[0]), String(params[1]))
        appMeta.set(String(params[2]), String(params[3]))
        return { rows: [] }
      }
      const rows: Array<{ key: string; value: string }> = []
      for (const key of params.map(String)) {
        const value = appMeta.get(key)
        if (value !== undefined) rows.push({ key, value })
      }
      return { rows }
    })

    const settings = await setDutySlots(
      { openDutySlots: 3, closedDutySlots: 2 },
      { id: 1, role: 'administrator' },
    )
    expect(settings).toEqual({ openDutySlots: 3, closedDutySlots: 2 })
    const upsert = query.mock.calls.find((c) => String(c[0]).includes('ON CONFLICT'))
    expect(upsert?.[1]).toEqual(['open_duty_slots', '3', 'closed_duty_slots', '2'])
    expect(logActivity).toHaveBeenCalledWith({
      userId: 1,
      action: 'duty_slots_settings.updated',
      entityType: 'duty_slots_settings',
      entityId: null,
      detail: {
        previousOpenDutySlots: 2,
        previousClosedDutySlots: 2,
        openDutySlots: 3,
        closedDutySlots: 2,
      },
    })
  })
})

describe('settings.service duty minimums', () => {
  /** Serves app_meta reads from the map and applies two-key upserts to it. */
  function useAppMeta(initial: Record<string, string>): Map<string, string> {
    const appMeta = new Map(Object.entries(initial))
    query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('INSERT INTO app_meta')) {
        appMeta.set(String(params[0]), String(params[1]))
        appMeta.set(String(params[2]), String(params[3]))
        return { rows: [] }
      }
      const rows: Array<{ key: string; value: string }> = []
      for (const key of params.map(String)) {
        const value = appMeta.get(key)
        if (value !== undefined) rows.push({ key, value })
      }
      return { rows }
    })
    return appMeta
  }

  it('missing minimum rows fall back to the slot counts (full coverage)', async () => {
    useAppMeta({ open_duty_slots: '4', closed_duty_slots: '3' })
    await expect(getDutyMinimums()).resolves.toEqual({ openDutyMinimum: 4, closedDutyMinimum: 3 })
  })

  it('a stored minimum above its slot count is clamped to the slot count', async () => {
    useAppMeta({
      open_duty_slots: '4',
      closed_duty_slots: '2',
      open_duty_minimum: '2',
      closed_duty_minimum: '5',
    })
    await expect(getDutyMinimums()).resolves.toEqual({ openDutyMinimum: 2, closedDutyMinimum: 2 })
  })

  it('setDutyMinimums upserts both keys, audits duty_minimums_settings.updated, returns fresh settings', async () => {
    useAppMeta({ open_duty_slots: '4', closed_duty_slots: '2' })
    const settings = await setDutyMinimums(
      { openDutyMinimum: 2, closedDutyMinimum: 1 },
      { id: 1, role: 'administrator' },
    )
    expect(settings).toEqual({ openDutyMinimum: 2, closedDutyMinimum: 1 })
    const upsert = query.mock.calls.find((c) => String(c[0]).includes('ON CONFLICT'))
    expect(upsert?.[1]).toEqual(['open_duty_minimum', '2', 'closed_duty_minimum', '1'])
    expect(logActivity).toHaveBeenCalledWith({
      userId: 1,
      action: 'duty_minimums_settings.updated',
      entityType: 'duty_minimums_settings',
      entityId: null,
      detail: {
        previousOpenDutyMinimum: 4,
        previousClosedDutyMinimum: 2,
        openDutyMinimum: 2,
        closedDutyMinimum: 1,
      },
    })
  })

  it('setDutyMinimums 409 when a minimum exceeds its slot count, without saving', async () => {
    useAppMeta({ open_duty_slots: '4', closed_duty_slots: '2' })
    await expect(
      setDutyMinimums({ openDutyMinimum: 4, closedDutyMinimum: 3 }, { id: 1, role: 'administrator' }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('closed days have 2') })
    expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO app_meta'))).toBe(false)
    expect(logActivity).not.toHaveBeenCalled()
  })

  it('setDutySlots 409 when a slot count drops below a stored minimum, without saving', async () => {
    useAppMeta({ open_duty_slots: '4', closed_duty_slots: '2', open_duty_minimum: '3' })
    await expect(
      setDutySlots({ openDutySlots: 2, closedDutySlots: 1 }, { id: 1, role: 'administrator' }),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('open minimum is 3') })
    expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO app_meta'))).toBe(false)
  })
})
