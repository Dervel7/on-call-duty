import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const list = vi.fn()
vi.mock('@/services/schedule', () => ({
  list: (...a: unknown[]) => list(...a),
}))
const push = vi.fn()
const route = { query: {} as Record<string, string> }
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => route,
}))

const clinicsList = vi.fn()
vi.mock('@/services/clinics', () => ({
  list: (...a: unknown[]) => clinicsList(...a),
  create: vi.fn(),
  update: vi.fn(),
}))

import ScheduleRosterPage from '../pages/ScheduleRosterPage.vue'
import { useAuthStore } from '../stores/auth'

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
  return mount(ScheduleRosterPage, { global: { plugins: [pinia] } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  route.query = {}
  list.mockReset()
  push.mockReset()
  clinicsList.mockReset()
})

describe('ScheduleRosterPage', () => {
  it('renders schedules read-only and navigates on View (manager)', async () => {
    route.query = { clinic: '1' }
    list.mockResolvedValue([
      {
        id: 3, year: 2026, month: 9, status: 'published', createdBy: 1,
        createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ])
    const wrapper = mountAsManager()
    await flushPromises()

    expect(wrapper.text()).toContain('September 2026')
    expect(list).toHaveBeenCalledWith({ clinicId: 1 })
    const buttonTexts = wrapper.findAll('button').map((b) => b.text())
    expect(buttonTexts.some((t) => t === 'View')).toBe(true)
    expect(buttonTexts.some((t) => /edit|delete|publish|generate/i.test(t))).toBe(false)
    await wrapper.findAll('button').find((b) => b.text() === 'View')!.trigger('click')
    expect(push).toHaveBeenCalledWith('/schedules/3')
  })

  it('manager mode without a clinic selection skips the fetch', async () => {
    const wrapper = mountAsManager()
    await flushPromises()
    expect(list).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Select a clinic above to view its duty roster.')
  })
})
