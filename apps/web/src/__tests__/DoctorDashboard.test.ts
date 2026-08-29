import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const me = vi.fn()
vi.mock('@/services/stats', () => ({
  admin: vi.fn(),
  me: (...a: unknown[]) => me(...a),
}))

import DoctorDashboard from '../components/dashboard/DoctorDashboard.vue'

function fullMe(overrides: Record<string, unknown> = {}) {
  return {
    doctor: { id: 10, firstName: 'Jane', lastName: 'Roe', maxMonthlyDuties: 7 },
    currentMonth: {
      year: 2026,
      month: 8,
      published: true,
      duties: 4,
      weekend: 1,
      holiday: 0,
      maxMonthly: 7,
    },
    upcoming: [{ dutyDate: '2099-01-01', isWeekend: false, isHoliday: false }],
    onCall: [
      {
        date: '2099-01-01',
        doctorFirstName: 'Jane',
        doctorLastName: 'Roe',
        isWeekend: false,
        isHoliday: false,
        isMine: true,
      },
      {
        date: '2099-01-02',
        doctorFirstName: 'Other',
        doctorLastName: 'Doc',
        isWeekend: true,
        isHoliday: false,
        isMine: false,
      },
      {
        date: '2099-01-02',
        doctorFirstName: 'Second',
        doctorLastName: 'Doc',
        isWeekend: true,
        isHoliday: false,
        isMine: false,
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  me.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('DoctorDashboard', () => {
  it('renders greeting, progress, isMine highlight, and upcoming', async () => {
    me.mockResolvedValue(fullMe())
    const w = mount(DoctorDashboard, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(w.text()).toContain('Welcome, Jane')
    expect(w.text()).toContain('4 / 7 duties this month')
    expect(w.text()).toContain('Jane Roe')
    expect(w.text()).toContain('Other Doc')
    expect(w.text()).toContain('You')
  })

  it('merges same-date on-call entries into one row with both names', async () => {
    me.mockResolvedValue(fullMe())
    const w = mount(DoctorDashboard, { global: { plugins: [createPinia()] } })
    await flushPromises()
    const rows = w.findAll('ul')[0]?.findAll('li') ?? []
    expect(rows).toHaveLength(2)
    expect(rows[1]?.text()).toContain('02 Jan')
    expect(rows[1]?.text()).toContain('Other Doc, Second Doc')
  })

  it('shows the not-published note and both empty states', async () => {
    me.mockResolvedValue(
      fullMe({
        currentMonth: {
          year: 2026,
          month: 8,
          published: false,
          duties: 0,
          weekend: 0,
          holiday: 0,
          maxMonthly: 7,
        },
        upcoming: [],
        onCall: [],
      }),
    )
    const w = mount(DoctorDashboard, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(w.text()).toContain("isn't published yet")
    expect(w.text()).toContain('No published schedule covers this period.')
    expect(w.text()).toContain('No upcoming on-call duties.')
  })
})
