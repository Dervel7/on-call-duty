import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const monthly = vi.fn()
vi.mock('@/services/reports', () => ({
  monthly: (...a: unknown[]) => monthly(...a),
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
        reason: 'engine',
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

beforeEach(() => {
  setActivePinia(createPinia())
  monthly.mockReset()
  downloadCsv.mockReset()
  push.mockReset()
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
    expect(w.text()).toContain('Well balanced')
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
})
