import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/components/dashboard/AdminDashboard.vue', () => ({
  default: { name: 'AdminDashboard', template: '<div data-test="admin">admin</div>' },
}))
vi.mock('@/components/dashboard/DoctorDashboard.vue', () => ({
  default: { name: 'DoctorDashboard', template: '<div data-test="doctor">doctor</div>' },
}))

import type { AuthUser } from '@oncall/shared'
import HomePage from '../pages/HomePage.vue'
import { useAuthStore } from '@/stores/auth'

function user(role: AuthUser['role']): AuthUser {
  return { id: 1, email: 'a@b.c', role, firstName: 'A', lastName: 'B' }
}

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.restoreAllMocks())

describe('HomePage', () => {
  it('renders AdminDashboard for an administrator', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore(pinia).user = user('administrator')
    const w = mount(HomePage, { global: { plugins: [pinia] } })
    expect(w.find('[data-test="admin"]').exists()).toBe(true)
    expect(w.find('[data-test="doctor"]').exists()).toBe(false)
  })

  it('renders DoctorDashboard for a doctor', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore(pinia).user = user('doctor')
    const w = mount(HomePage, { global: { plugins: [pinia] } })
    expect(w.find('[data-test="doctor"]').exists()).toBe(true)
    expect(w.find('[data-test="admin"]').exists()).toBe(false)
  })
})
