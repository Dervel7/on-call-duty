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

/** One clinics row with its slot counts, minimums, and active doctor count. */
interface ClinicRow {
  open_duty_slots: number
  post_open_duty_slots: number
  closed_duty_slots: number
  open_duty_minimum: number
  post_open_duty_minimum: number
  closed_duty_minimum: number
  active_doctors: number
}

function clinicRow(overrides: Partial<ClinicRow> = {}): ClinicRow {
  return {
    open_duty_slots: 2,
    post_open_duty_slots: 2,
    closed_duty_slots: 2,
    open_duty_minimum: 2,
    post_open_duty_minimum: 2,
    closed_duty_minimum: 2,
    active_doctors: 30,
    ...overrides,
  }
}

/** Serves every clinics SELECT from one row and applies the UPDATEs to it. */
function useClinic(initial: ClinicRow): { row: ClinicRow } {
  const state = { row: initial }
  query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('UPDATE clinics') && sql.includes('open_duty_slots')) {
      state.row = {
        ...state.row,
        open_duty_slots: Number(params[1]),
        post_open_duty_slots: Number(params[2]),
        closed_duty_slots: Number(params[3]),
      }
      return { rows: [] }
    }
    if (sql.includes('UPDATE clinics') && sql.includes('open_duty_minimum')) {
      state.row = {
        ...state.row,
        open_duty_minimum: Number(params[1]),
        post_open_duty_minimum: Number(params[2]),
        closed_duty_minimum: Number(params[3]),
      }
      return { rows: [] }
    }
    return { rows: [state.row] }
  })
  return state
}

describe('settings.service duty slots', () => {
  it('reads the clinic slot counts and active doctor count', async () => {
    query.mockResolvedValue({
      rows: [clinicRow({ open_duty_slots: 3, post_open_duty_slots: 4, closed_duty_slots: 1 })],
    })
    await expect(getClinicDutySlots(4)).resolves.toEqual({
      openDutySlots: 3,
      postOpenDutySlots: 4,
      closedDutySlots: 1,
      activeDoctors: 30,
    })
    expect(query.mock.calls[0]?.[1]).toEqual([4])
  })

  it('an unknown clinic is 404', async () => {
    query.mockResolvedValue({ rows: [] })
    await expect(getDutySlots(99)).rejects.toMatchObject({ status: 404 })
    await expect(getClinicDutySlots(99)).rejects.toMatchObject({ status: 404 })
    await expect(getDutyMinimums(99)).rejects.toMatchObject({ status: 404 })
  })

  it('setDutySlots accepts counts up to the active doctor count (above the old 7 ceiling)', async () => {
    useClinic(clinicRow())

    const settings = await setDutySlots(
      { openDutySlots: 30, postOpenDutySlots: 12, closedDutySlots: 10 },
      { id: 1, role: 'administrator' },
      4,
    )
    expect(settings).toEqual({
      openDutySlots: 30,
      postOpenDutySlots: 12,
      closedDutySlots: 10,
      activeDoctors: 30,
    })
    const update = query.mock.calls.find((c) => String(c[0]).includes('UPDATE clinics'))
    expect(update?.[1]).toEqual([4, 30, 12, 10])
    expect(logActivity).toHaveBeenCalledWith({
      userId: 1,
      action: 'duty_slots_settings.updated',
      entityType: 'duty_slots_settings',
      entityId: null,
      clinicId: 4,
      detail: {
        previousOpenDutySlots: 2,
        previousPostOpenDutySlots: 2,
        previousClosedDutySlots: 2,
        openDutySlots: 30,
        postOpenDutySlots: 12,
        closedDutySlots: 10,
      },
    })
  })

  it('setDutySlots rejects any count above the active doctor count (422) without writing', async () => {
    useClinic(clinicRow({ active_doctors: 5 }))
    for (const input of [
      { openDutySlots: 6, postOpenDutySlots: 2, closedDutySlots: 2 },
      { openDutySlots: 2, postOpenDutySlots: 6, closedDutySlots: 2 },
      { openDutySlots: 2, postOpenDutySlots: 2, closedDutySlots: 6 },
    ]) {
      await expect(
        setDutySlots(input, { id: 1, role: 'administrator' }, 4),
      ).rejects.toMatchObject({ status: 422 })
    }
    expect(query.mock.calls.some((c) => String(c[0]).includes('UPDATE clinics'))).toBe(false)
    expect(logActivity).not.toHaveBeenCalled()
  })

  it('setDutySlots 409 when a slot count drops below its minimum, without saving', async () => {
    useClinic(
      clinicRow({
        open_duty_slots: 4,
        post_open_duty_slots: 3,
        open_duty_minimum: 1,
        post_open_duty_minimum: 3,
        closed_duty_minimum: 1,
      }),
    )
    await expect(
      setDutySlots(
        { openDutySlots: 4, postOpenDutySlots: 2, closedDutySlots: 2 },
        { id: 1, role: 'administrator' },
        4,
      ),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('day-after-open minimum is 3') })
    expect(query.mock.calls.some((c) => String(c[0]).includes('UPDATE clinics'))).toBe(false)
  })
})

describe('settings.service duty minimums', () => {
  it('reads the clinic minimums', async () => {
    useClinic(
      clinicRow({
        open_duty_slots: 4,
        post_open_duty_slots: 5,
        closed_duty_slots: 3,
        open_duty_minimum: 3,
        post_open_duty_minimum: 4,
        closed_duty_minimum: 1,
      }),
    )
    await expect(getDutyMinimums(4)).resolves.toEqual({
      openDutyMinimum: 3,
      postOpenDutyMinimum: 4,
      closedDutyMinimum: 1,
    })
    expect(query.mock.calls[0]?.[1]).toEqual([4])
  })

  it('a stored minimum above its slot count is clamped to the slot count', async () => {
    useClinic(
      clinicRow({
        open_duty_slots: 4,
        post_open_duty_slots: 3,
        closed_duty_slots: 2,
        open_duty_minimum: 2,
        post_open_duty_minimum: 6,
        closed_duty_minimum: 5,
      }),
    )
    await expect(getDutyMinimums(4)).resolves.toEqual({
      openDutyMinimum: 2,
      postOpenDutyMinimum: 3,
      closedDutyMinimum: 2,
    })
  })

  it('setDutyMinimums updates the clinic, audits duty_minimums_settings.updated, returns fresh settings', async () => {
    useClinic(
      clinicRow({
        open_duty_slots: 4,
        post_open_duty_slots: 3,
        closed_duty_slots: 2,
        open_duty_minimum: 4,
        post_open_duty_minimum: 3,
        closed_duty_minimum: 2,
      }),
    )
    const settings = await setDutyMinimums(
      { openDutyMinimum: 2, postOpenDutyMinimum: 3, closedDutyMinimum: 1 },
      { id: 1, role: 'administrator' },
      4,
    )
    expect(settings).toEqual({ openDutyMinimum: 2, postOpenDutyMinimum: 3, closedDutyMinimum: 1 })
    const update = query.mock.calls.find((c) => String(c[0]).includes('UPDATE clinics'))
    expect(update?.[1]).toEqual([4, 2, 3, 1])
    expect(logActivity).toHaveBeenCalledWith({
      userId: 1,
      action: 'duty_minimums_settings.updated',
      entityType: 'duty_minimums_settings',
      entityId: null,
      clinicId: 4,
      detail: {
        previousOpenDutyMinimum: 4,
        previousPostOpenDutyMinimum: 3,
        previousClosedDutyMinimum: 2,
        openDutyMinimum: 2,
        postOpenDutyMinimum: 3,
        closedDutyMinimum: 1,
      },
    })
  })

  it('setDutyMinimums 409 when a minimum exceeds its slot count, without saving', async () => {
    useClinic(clinicRow({ open_duty_slots: 4, post_open_duty_slots: 2, closed_duty_slots: 2 }))
    await expect(
      setDutyMinimums(
        { openDutyMinimum: 4, postOpenDutyMinimum: 3, closedDutyMinimum: 2 },
        { id: 1, role: 'administrator' },
        4,
      ),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining('days after open have 2') })
    expect(query.mock.calls.some((c) => String(c[0]).includes('UPDATE clinics'))).toBe(false)
    expect(logActivity).not.toHaveBeenCalled()
  })
})
