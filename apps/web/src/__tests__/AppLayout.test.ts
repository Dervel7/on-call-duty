import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  RouterLink: { template: '<a><slot /></a>' },
  useRoute: () => ({ path: '/' }),
  useRouter: () => ({ push: vi.fn() }),
}))

import AppLayout from '../components/layout/AppLayout.vue'

let wrapper: VueWrapper | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  localStorage.clear()
})

async function mountLayout(): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.user = {
    id: 1,
    email: 'd@h.com',
    username: 'd',
    role: 'doctor',
    firstName: 'D',
    lastName: 'Oc',
    darkMode: false,
    language: 'en',
    clinicId: 1,
    clinicName: 'Main Clinic',
  }
  auth.accessToken = 'token'
  wrapper = mount(AppLayout, {
    slots: { default: '<p>page</p>' },
    attachTo: document.body,
    global: { plugins: [pinia] },
  })
  await flushPromises()
  return wrapper
}

describe('AppLayout', () => {
  it('opens the navigation drawer from the menu button', async () => {
    const w = await mountLayout()
    const menu = w.find('button[aria-label="Open menu"]')
    expect(menu.attributes('aria-expanded')).toBe('false')
    await menu.trigger('click')
    await flushPromises()
    expect(menu.attributes('aria-expanded')).toBe('true')
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('keeps the rail preference across a reload', async () => {
    const first = await mountLayout()
    await first.find('aside button[aria-controls="app-sidebar"]').trigger('click')
    await flushPromises()
    first.unmount()
    wrapper = undefined

    const second = await mountLayout()
    expect(second.find('aside button[aria-controls="app-sidebar"]').text()).toBe('Expand sidebar')
  })
})
