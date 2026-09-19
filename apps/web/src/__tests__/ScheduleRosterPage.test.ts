import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const list = vi.fn()
vi.mock('@/services/schedule', () => ({
  list: (...a: unknown[]) => list(...a),
}))
const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
}))

import ScheduleRosterPage from '../pages/ScheduleRosterPage.vue'
import { useAuthStore } from '../stores/auth'

beforeEach(() => {
  setActivePinia(createPinia())
  list.mockReset()
  push.mockReset()
})

describe('ScheduleRosterPage', () => {
  it('renders schedules read-only and navigates on View (manager)', async () => {
    list.mockResolvedValue([
      {
        id: 3, year: 2026, month: 9, status: 'published', createdBy: 1,
        createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ])
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
    const wrapper = mount(ScheduleRosterPage, { global: { plugins: [pinia] } })
    await flushPromises()

    expect(wrapper.text()).toContain('September 2026')
    expect(wrapper.findAll('button').every((b) => b.text() === 'View')).toBe(true)
    await wrapper.findAll('button').find((b) => b.text() === 'View')!.trigger('click')
    expect(push).toHaveBeenCalledWith('/schedules/3')
  })
})
