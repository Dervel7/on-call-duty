import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

const me = vi.fn()
vi.mock('@/services/doctor', () => ({ me: (...a: unknown[]) => me(...a) }))

import ProfilePage from '../pages/ProfilePage.vue'

beforeEach(() => {
  me.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('ProfilePage doctor self-view', () => {
  it('shows the on-call profile card for a doctor', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.user = {
      id: 10,
      email: 'dr@h.com',
      role: 'doctor',
      firstName: 'Jane',
      lastName: 'Roe',
    }
    me.mockResolvedValue({
      id: 1,
      userId: 10,
      email: 'dr@h.com',
      firstName: 'Jane',
      lastName: 'Roe',
      isActive: true,
      maxMonthlyDuties: 7,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const wrapper = mount(ProfilePage, { global: { plugins: [pinia] } })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('My on-call profile')
    expect(wrapper.text()).toContain('Max monthly duties')
  })
})
