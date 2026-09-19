import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const monthly = vi.fn()
vi.mock('@/services/reports', () => ({
  monthly: (...a: unknown[]) => monthly(...a),
}))
const downloadCsv = vi.fn()
vi.mock('@/lib/download', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/download')>()
  return {
    downloadCsv: (...a: unknown[]) => downloadCsv(...a),
    csvFilename: actual.csvFilename,
  }
})
const route = { query: {} as Record<string, string> }
const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }), useRoute: () => route }))

const clinicsList = vi.fn()
vi.mock('@/services/clinics', () => ({
  list: (...a: unknown[]) => clinicsList(...a),
  create: vi.fn(),
  update: vi.fn(),
}))
 
import ReportsPage from '../pages/ReportsPage.vue'
import { useAuthStore } from '../stores/auth'


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
  route.query = {}
  monthly.mockReset()
  downloadCsv.mockReset()
  push.mockReset()
  clinicsList.mockReset()
})
afterEach(() => vi.restoreAllMocks())

function mountAsManager() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore(pinia).user = {
    id: 1,
    email: 'm@oncall.local',
    username: 'manager',
    role: 'manager',
    firstName: 'Max',
    lastName: 'Manager',
    darkMode: false,
    clinicId: null,
    clinicName: null,
  }
  clinicsList.mockResolvedValue([
    { id: 1, name: 'Radiology', isActive: true, doctorCount: 3, adminCount: 1 },
    { id: 2, name: 'Cardiology', isActive: true, doctorCount: 3, adminCount: 1 },
  ])
  return mount(ReportsPage, { global: { plugins: [pinia] } })
}

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
  it('manager mode: selector present, report scoped to the selected clinic with its name', async () => {
    route.query = { clinic: '2' }
    monthly.mockResolvedValue(fullReport({ clinicName: 'Cardiology' }))
    const w = mountAsManager()
    await flushPromises()
    expect(w.find('[data-testid="clinic-selector"]').exists()).toBe(true)
    expect(monthly).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 2 }))
    expect(w.text()).toContain('Cardiology')

    const exportBtn = w.findAll('button').find((b) => b.text().includes('Export CSV'))!
    await exportBtn.trigger('click')
    const now = new Date()
    const monthPart = String(now.getUTCMonth() + 1).padStart(2, '0')
    expect(downloadCsv).toHaveBeenCalledWith(
      `oncall-cardiology-${now.getUTCFullYear()}-${monthPart}.csv`,
      expect.any(String),
    )
  })

  it('manager mode without a clinic selection shows the select-a-clinic state and skips the fetch', async () => {
    const w = mountAsManager()
    await flushPromises()
    expect(monthly).not.toHaveBeenCalled()
    expect(w.text()).toContain('Select a clinic')
  })
})

