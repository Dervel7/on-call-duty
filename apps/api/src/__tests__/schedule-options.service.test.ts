import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
vi.mock('../db/client.ts', () => ({
  query: (...a: unknown[]) => query(...a),
  withTransaction: (work: (c: { query: typeof query }) => Promise<unknown>) => work({ query }),
}))

const recordActivity = vi.fn()
vi.mock('../services/activity.service.ts', () => ({
  recordActivity: (...a: unknown[]) => recordActivity(...a),
}))

// Per-clinic slot counts and minimums come from the clinics row; pin the
// seeded 2/2/2 slots (tests override the minimums) so the query sequences
// below only carry the cycle (app_meta) lookups.
const getDutyMinimums = vi.fn()
vi.mock('../services/settings.service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/settings.service.ts')>()),
  getDutySlots: async () => ({ openDutySlots: 2, postOpenDutySlots: 2, closedDutySlots: 2 }),
  getDutyMinimums: (...a: unknown[]) => getDutyMinimums(...a),
}))

import { generateAlternative, generateOptions } from '../services/schedule-options.service.ts'
import { CLINIC_DOCTORS as doctors, SCOPE, SEEDED_MINIMUMS } from './helpers/schedule-fixtures.ts'

beforeEach(() => {
  query.mockReset()
  recordActivity.mockReset()
  getDutyMinimums.mockReset()
  getDutyMinimums.mockResolvedValue(SEEDED_MINIMUMS)
})

describe('schedule options', () => {
  function mockClinicData() {
    query.mockImplementation(async (text: unknown) => {
      const sql = String(text)
      if (sql.includes('FROM doctors d JOIN users')) return { rows: doctors }
      return { rows: [] }
    })
  }

  it('returns only option A, persisting nothing', async () => {
    mockClinicData()
    const res = await generateOptions(2026, 9, SCOPE)
    expect(res.options).toHaveLength(1)
    expect(res.options[0]).toMatchObject({ index: 1, changedDates: [] })
    expect(res.options[0]?.days).toHaveLength(30)
    expect(res.maxOptions).toBe(3)
    expect(res.moreAvailable).toBe(true)
    expect(query.mock.calls.some((c) => String(c[0]).startsWith('INSERT'))).toBe(false)
    expect(recordActivity).not.toHaveBeenCalled()
  })

  it('solves B once, then returns the cached B and builds C after it', async () => {
    mockClinicData()
    const a = await generateOptions(2026, 9, SCOPE)
    const b = await generateAlternative(2026, 9, 2, SCOPE)
    expect(b.option).toMatchObject({ index: 2 })
    expect(b.option?.changedDates.length).toBeGreaterThan(0)
    expect(b.moreAvailable).toBe(true)
    const again = await generateAlternative(2026, 9, 2, SCOPE)
    expect(again.option).toBe(b.option)
    const c = await generateAlternative(2026, 9, 3, SCOPE)
    expect(c.option).toMatchObject({ index: 3 })
    expect(c.moreAvailable).toBe(false)
    const keys = [a.options[0], b.option, c.option].map((o) =>
      o!.assignments.map((x) => `${x.date}/${x.doctorId}`).sort().join(','),
    )
    expect(new Set(keys).size).toBe(3)
  })

  it('400 when option 3 is asked before option 2', async () => {
    mockClinicData()
    await generateOptions(2026, 9, SCOPE)
    await expect(generateAlternative(2026, 9, 3, SCOPE)).rejects.toMatchObject({ status: 400 })
  })

  it('404 when no options were generated for the month', async () => {
    mockClinicData()
    await expect(generateAlternative(2031, 3, 2, SCOPE)).rejects.toMatchObject({
      status: 404,
      message: 'Options expired, generate them again',
    })
  })

  it('404 after the cache entry expires', async () => {
    mockClinicData()
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      await generateOptions(2026, 9, SCOPE)
      vi.setSystemTime(Date.now() + 16 * 60_000)
      await expect(generateAlternative(2026, 9, 2, SCOPE)).rejects.toMatchObject({ status: 404 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('alternative 409 when the month already exists, before the cache is read', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    await expect(generateAlternative(2026, 9, 2, SCOPE)).rejects.toMatchObject({ status: 409 })
  })

  it('429 while another solve holds the slot, and the first solve still finishes', async () => {
    mockClinicData()
    const first = generateOptions(2026, 9, SCOPE)
    await expect(generateOptions(2026, 9, SCOPE)).rejects.toMatchObject({
      status: 429,
      message: 'Solver busy, try again shortly',
    })
    expect((await first).options).toHaveLength(1)
  })
})
