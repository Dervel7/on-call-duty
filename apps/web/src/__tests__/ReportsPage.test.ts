import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { pickOption } from './pick-option'

const monthly = vi.fn()
vi.mock('@/services/reports', () => ({
  monthly: (...a: unknown[]) => monthly(...a),
}))
const scheduleGet = vi.fn()
vi.mock('@/services/schedule', () => ({
  get: (...a: unknown[]) => scheduleGet(...a),
}))
const downloadCsv = vi.fn()
vi.mock('@/lib/download', () => ({
  downloadCsv: (...a: unknown[]) => downloadCsv(...a),
}))
const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

import ReportsPage from '../pages/ReportsPage.vue'

function fullReport(overrides: Record<string, unknown> = {}) {
  return {
    year: 2026,
    month: 8,
    generatedAt: '2026-08-07T10:00:00.000Z',
    schedule: {
      id: 1,
      year: 2026,
      month: 8,
      status: 'published',
      createdBy: 1,
      createdAt: '',
      updatedAt: '',
    },
    roster: [
      {
        id: 1,
        scheduleId: 1,
        dutyDate: '2026-08-01',
        doctorId: 5,
        doctorFirstName: 'Jane',
        doctorLastName: 'Roe',
        isWeekend: false,
        reason: 'score 30 (workload +30, weekend +0, friday +0)',
        createdAt: '',
      },
    ],
    coverage: { daysInMonth: 31, filled: 1, gaps: [] },
    workload: [
      {
        doctorId: 5,
        firstName: 'Jane',
        lastName: 'Roe',
        isActive: true,
        maxMonthly: 7,
        duties: 1,
        weekday: 1,
        weekend: 0,
      },
    ],
    fairness: { dutySpread: 0, weekendSpread: 0 },
    ...overrides,
  }
}

function scheduleDetail(overrides: Record<string, unknown> = {}) {
  const base = fullReport()
  const days = Array.from({ length: 31 }, (_, i) => {
    const date = `2026-08-${String(i + 1).padStart(2, '0')}`
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay()
    return {
      date,
      isWeekend: dow === 0 || dow === 6,
      dutyType: 'closed',
      slotsRequired: 2,
      eligibleDoctorIds: [5],
      availableDoctorIds: [5],
    }
  })
  return { schedule: base.schedule, duties: base.roster, days, ...overrides }
}

beforeEach(() => {
  setActivePinia(createPinia())
  monthly.mockReset()
  downloadCsv.mockReset()
  push.mockReset()
  scheduleGet.mockReset()
  scheduleGet.mockResolvedValue(scheduleDetail())
})
afterEach(() => vi.restoreAllMocks())

describe('ReportsPage', () => {
  it('renders the empty state and navigates to /schedules when no schedule', async () => {
    monthly.mockResolvedValue(
      fullReport({
        schedule: null,
        roster: [],
        coverage: { daysInMonth: 31, filled: 0, gaps: [] },
        workload: [],
        fairness: { dutySpread: null, weekendSpread: null },
      }),
    )
    const w = mount(ReportsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(w.text()).toContain('No schedule for')
    const go = w.findAll('button').find((b) => b.text().includes('Go to Schedules'))!
    await go.trigger('click')
    expect(push).toHaveBeenCalledWith('/schedules')
  })

  it('renders header, roster, workload, and fairness', async () => {
    monthly.mockResolvedValue(fullReport())
    const w = mount(ReportsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(w.text()).toContain('On-Call Duty')
    expect(w.text()).toContain('Published')
    expect(w.text()).toContain('Jane Roe')
    expect(w.text()).toContain('Why this doctor')
    expect(w.text()).toContain('Picked for fair workload — most room left under their monthly duty limit')
  })

  it('marks an unassigned gap day in the roster', async () => {
    monthly.mockResolvedValue(fullReport())
    const w = mount(ReportsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(w.text()).toContain('Unassigned')
    expect(w.text()).toContain('Gap day')
  })

  it('reloads on Apply', async () => {
    monthly.mockResolvedValue(fullReport())
    const w = mount(ReportsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    const apply = w.findAll('button').find((b) => b.text().includes('Apply'))!
    await apply.trigger('click')
    await flushPromises()
    expect(monthly).toHaveBeenCalledTimes(2)
  })

  it('reloads immediately when the month changes and a year is set', async () => {
    monthly.mockResolvedValue(fullReport())
    const w = mount(ReportsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    const otherMonth = String(((new Date().getUTCMonth() + 1) % 12) + 1)
    await pickOption(w.element, '#r-month', otherMonth)
    await flushPromises()
    expect(monthly).toHaveBeenCalledTimes(2)
    expect(monthly).toHaveBeenLastCalledWith({
      year: new Date().getUTCFullYear(),
      month: Number(otherMonth),
    })
  })

  it('does not auto-apply on month change when the year field is empty', async () => {
    monthly.mockResolvedValue(fullReport())
    const w = mount(ReportsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    const otherMonth = String(((new Date().getUTCMonth() + 1) % 12) + 1)
    await w.find('#r-year').setValue('')
    await pickOption(w.element, '#r-month', otherMonth)
    await flushPromises()
    expect(monthly).toHaveBeenCalledTimes(1)
  })

  it('Export CSV triggers downloadCsv with the expected filename', async () => {
    monthly.mockResolvedValue(fullReport())
    const w = mount(ReportsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    const exportBtn = w.findAll('button').find((b) => b.text().includes('Export CSV'))!
    await exportBtn.trigger('click')
    expect(downloadCsv).toHaveBeenCalledTimes(1)
    const [filename, csv] = downloadCsv.mock.calls[0]!
    expect(filename).toMatch(/^oncall-\d{4}-\d{2}\.csv$/)
    expect(csv).toContain('Date,Weekday,Doctor,Weekend,Reason')
    expect(csv).toContain('Jane Roe')
  })

  it('Print button calls window.print', async () => {
    const printSpy = vi.fn()
    const original = window.print
    window.print = printSpy
    monthly.mockResolvedValue(fullReport())
    try {
      const w = mount(ReportsPage, { global: { plugins: [createPinia()] } })
      await flushPromises()
      const printBtn = w.findAll('button').find((b) => b.text().includes('Print'))!
      await printBtn.trigger('click')
      expect(printSpy).toHaveBeenCalledTimes(1)
    } finally {
      window.print = original
    }
  })

  it('renders the printable duty roster calendar from the schedule detail', async () => {
    monthly.mockResolvedValue(fullReport())
    const w = mount(ReportsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(scheduleGet).toHaveBeenCalledWith(1)
    const printArea = w.find('.print-only')
    expect(printArea.exists()).toBe(true)
    expect(printArea.text()).toContain('Duty roster')
    expect(printArea.text()).toContain('August 2026')
    expect(printArea.text()).toContain('Roe J.')
    expect(printArea.text()).not.toContain('Workload')
  })

  it('disables Print when the duty roster calendar fails to load', async () => {
    monthly.mockResolvedValue(fullReport())
    scheduleGet.mockRejectedValue(new Error('boom'))
    const w = mount(ReportsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    const printBtn = w.findAll('button').find((b) => b.text().includes('Print'))!
    expect(printBtn.attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('Failed to load the duty roster calendar')
  })

  function deferred<T>() {
    let resolve!: (v: T) => void
    const promise = new Promise<T>((r) => (resolve = r))
    return { promise, resolve }
  }

  it('ignores a stale report response that resolves after a newer one (M1)', async () => {
    const first = deferred<unknown>()
    monthly.mockReturnValueOnce(first.promise)
    const w = mount(ReportsPage, { global: { plugins: [createPinia()] } })
    const july = fullReport({ month: 7, schedule: { ...fullReport().schedule, id: 2, month: 7 } })
    monthly.mockResolvedValueOnce(july)
    const apply = w.findAll('button').find((b) => b.text().includes('Apply'))!
    await apply.trigger('click')
    await flushPromises()
    first.resolve(fullReport())
    await flushPromises()
    expect(w.find('p.text-lg').text()).toBe('July 2026')
    expect(scheduleGet).toHaveBeenCalledTimes(1)
    expect(scheduleGet).toHaveBeenCalledWith(2)
  })

  it('ignores a stale nested calendar response (M1)', async () => {
    const cal = deferred<unknown>()
    monthly.mockResolvedValue(fullReport())
    scheduleGet.mockReturnValueOnce(cal.promise)
    const w = mount(ReportsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    monthly.mockResolvedValue(fullReport({ schedule: null, roster: [] }))
    const apply = w.findAll('button').find((b) => b.text().includes('Apply'))!
    await apply.trigger('click')
    await flushPromises()
    cal.resolve(scheduleDetail())
    await flushPromises()
    expect(w.find('.print-only').exists()).toBe(false)
    expect(w.text()).toContain('No schedule for')
  })

  it.each([
    [1, 1, null],
    [3, 2, '2 of 3'],
    [2, 1, '1 of 2'],
  ])('slotsRequired=%i with %i doctors shows %s (M4)', async (slots, filled, badge) => {
    const roster = Array.from({ length: filled }, (_, i) => ({ ...fullReport().roster[0], id: i + 1, doctorId: 5 + i }))
    monthly.mockResolvedValue(fullReport({ roster }))
    const base = scheduleDetail()
    scheduleGet.mockResolvedValue({ ...base, days: base.days.map((d) => ({ ...d, slotsRequired: slots })) })
    const w = mount(ReportsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    const row = w.findAll('tr').find((r) => r.text().includes('Sat 01'))!
    if (badge) expect(row.text()).toContain(badge)
    else expect(row.text()).not.toMatch(/\d of \d/)
  })

  it('uses the loaded report month for label and CSV filename, not unapplied inputs (M9)', async () => {
    monthly.mockResolvedValue(fullReport())
    const w = mount(ReportsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await w.find('#r-year').setValue('2030')
    expect(w.find('p.text-lg').text()).toBe('August 2026')
    const exportBtn = w.findAll('button').find((b) => b.text().includes('Export CSV'))!
    await exportBtn.trigger('click')
    expect(downloadCsv.mock.calls[0]![0]).toBe('oncall-2026-08.csv')
  })

  it('clears the report when a load fails (M9)', async () => {
    monthly.mockResolvedValueOnce(fullReport()).mockRejectedValueOnce(new Error('nope'))
    const w = mount(ReportsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    const apply = w.findAll('button').find((b) => b.text().includes('Apply'))!
    await apply.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('nope')
    expect(w.text()).not.toContain('Jane Roe')
    expect(w.findAll('button').some((b) => b.text().includes('Export CSV'))).toBe(false)
  })

  it.each(['', '1969', '2101'])('rejects year %j without calling the API (M9)', async (y) => {
    monthly.mockResolvedValue(fullReport())
    const w = mount(ReportsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await w.find('#r-year').setValue(y)
    const apply = w.findAll('button').find((b) => b.text().includes('Apply'))!
    await apply.trigger('click')
    await flushPromises()
    expect(monthly).toHaveBeenCalledTimes(1)
    expect(w.text()).toContain('Enter a year between 1970 and 2100')
  })
})
