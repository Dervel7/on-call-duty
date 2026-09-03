import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

const me = vi.fn()
vi.mock('@/services/doctor', () => ({ me: (...a: unknown[]) => me(...a) }))

const changePassword = vi.fn()
vi.mock('@/services/auth', () => ({
  login: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  fetchMe: vi.fn(),
  changePassword: (...a: unknown[]) => changePassword(...a),
}))

import ProfilePage from '../pages/ProfilePage.vue'

beforeEach(() => {
  me.mockReset()
  changePassword.mockReset()
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
      username: 'dr1',
      role: 'doctor',
      firstName: 'Jane',
      lastName: 'Roe',
    }
    me.mockResolvedValue({
      id: 1,
      userId: 10,
      email: 'dr@h.com',
      username: 'dr1',
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

describe('ProfilePage change password', () => {
  it('shows a visible success message and warns the current session ends', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.user = {
      id: 2,
      email: 'admin@h.com',
      username: 'admin',
      role: 'administrator',
      firstName: 'Ada',
      lastName: 'Admin',
    }
    changePassword.mockResolvedValue({ user: { ...auth.user } })
    const wrapper = mount(ProfilePage, { global: { plugins: [pinia] } })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('including this one')
    await wrapper.find('#current').setValue('oldpass')
    await wrapper.find('#new').setValue('newpass')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(changePassword).toHaveBeenCalledWith('oldpass', 'newpass')
    const status = wrapper.find('[role="status"]')
    expect(status.exists()).toBe(true)
    expect(status.text()).toContain('Password updated.')
    expect(status.classes()).toContain('text-success')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
})
