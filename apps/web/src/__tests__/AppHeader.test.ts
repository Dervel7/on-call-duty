import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { Role } from '@oncall/shared'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  RouterLink: { template: '<a><slot /></a>' },
  useRoute: () => ({ path: '/' }),
  useRouter: () => ({ push: vi.fn() }),
}))

import AppHeader from '../components/layout/AppHeader.vue'

const user = (role: Role) => ({
  id: 1,
  email: 'u@h.com',
  username: 'u',
  role,
  firstName: 'U',
  lastName: 'Ser',
  darkMode: false,
  clinicId: role === 'superadmin' ? null : 1,
  clinicName: 'Main Clinic',
})

async function mountHeader(role: Role) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.user = user(role)
  auth.accessToken = 'token'
  const wrapper = mount(AppHeader, { global: { plugins: [pinia] } })
  await flushPromises()
  // Desktop and mobile navs render the same items; keep one copy.
  return [...new Set(wrapper.findAll('nav a').map((a) => a.text()))]
}

describe('AppHeader navigation', () => {
  it('shows administrators every admin item, including Rules and Reports', async () => {
    const labels = await mountHeader('administrator')
    expect(labels).toEqual([
      'Home',
      'Users',
      'Availability',
      'Schedules',
      'Holidays',
      'Rules',
      'Reports',
      'Profile',
    ])
  })

  it('adds the superadmin-only items for the superadmin', async () => {
    const labels = await mountHeader('superadmin')
    expect(labels).toEqual([
      'Home',
      'Users',
      'Availability',
      'Schedules',
      'Holidays',
      'Rules',
      'Reports',
      'Activity',
      'Usage',
      'Profile',
    ])
  })

  it('shows doctors only the doctor items — no Rules or Reports', async () => {
    const labels = await mountHeader('doctor')
    expect(labels).toEqual(['Home', 'Duty roster', 'My availability', 'Profile'])
  })

  it('shows a manager no doctor or admin items', async () => {
    const labels = await mountHeader('manager')
    expect(labels).toEqual(['Home', 'Profile'])
  })
})

describe('AppHeader accessibility', () => {
  it('names both navs and the icon-only logout button', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.user = user('doctor')
    auth.accessToken = 'token'
    const wrapper = mount(AppHeader, { global: { plugins: [pinia] } })
    await flushPromises()
    expect(wrapper.findAll('nav').map((n) => n.attributes('aria-label'))).toEqual(['Main', 'Main (mobile)'])
    expect(wrapper.find('button[aria-label="Logout"]').exists()).toBe(true)
  })
})
