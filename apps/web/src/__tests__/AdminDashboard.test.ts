import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const admin = vi.fn()
vi.mock('@/services/stats', () => ({
  admin: (...a: unknown[]) => admin(...a),
  me: vi.fn(),
}))
const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

import AdminDashboard from '../components/dashboard/AdminDashboard.vue'

function fullStats(overrides: Record<string, unknown> = {}) {
  return {
    year: 2026,
    month: 8,
    schedule: {
      id: 1,
      year: 2026,
      month: 8,
      status: 'published',
      createdBy: 1,
      createdAt: '',
      updatedAt: '',
    },
    coverage: { daysInMonth: 31, filled: 31, gaps: [] },
    workload: [
      {
        doctorId: 1,
        firstName: 'Jane',
        lastName: 'Roe',
        isActive: true,
        maxMonthly: 7,
        duties: 7,
        weekday: 5,
        weekend: 2,
      },
      {
        doctorId: 2,
        firstName: 'Old',
        lastName: 'Doc',
        isActive: false,
        maxMonthly: 7,
        duties: 1,
        weekday: 1,
        weekend: 0,
      },
    ],
    fairness: { dutySpread: 6, weekendSpread: 2 },
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  admin.mockReset()
  push.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('AdminDashboard', () => {
  it('renders coverage, imbalanced fairness, and workload with inactive badge', async () => {
    admin.mockResolvedValue(fullStats())
    const w = mount(AdminDashboard, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(w.text()).toContain('31 / 31 days fully staffed')
    expect(w.text()).toContain('Imbalanced — review workload')
    expect(w.text()).toContain('Jane Roe')
    expect(w.text()).toContain('Old Doc')
    expect(w.text()).toContain('inactive')
  })

  it('shows Well balanced when dutySpread <= 1', async () => {
    admin.mockResolvedValue(
      fullStats({ fairness: { dutySpread: 1, weekendSpread: 0 } }),
    )
    const w = mount(AdminDashboard, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(w.text()).toContain('Well balanced')
  })

  it('shows the empty state and navigates to /schedules when no schedule', async () => {
    admin.mockResolvedValue(
      fullStats({
        schedule: null,
        coverage: { daysInMonth: 31, filled: 0, gaps: [] },
        workload: [],
        fairness: { dutySpread: null, weekendSpread: null },
      }),
    )
    const w = mount(AdminDashboard, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(w.text()).toContain('No schedule for')
    const go = w.findAll('button').find((b) => b.text().includes('Go to Schedules'))!
    await go.trigger('click')
    expect(push).toHaveBeenCalledWith('/schedules')
  })

  it('reloads stats on Apply', async () => {
    admin.mockResolvedValue(fullStats())
    const w = mount(AdminDashboard, { global: { plugins: [createPinia()] } })
    await flushPromises()
    const apply = w.findAll('button').find((b) => b.text().includes('Apply'))!
    await apply.trigger('click')
    await flushPromises()
    expect(admin).toHaveBeenCalledTimes(2)
  })
})
