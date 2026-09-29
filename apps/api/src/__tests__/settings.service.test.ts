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

import { getOpenDutySettings, setOpenDutyInterval } from '../services/settings.service'

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
