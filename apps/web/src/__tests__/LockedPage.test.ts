import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import LockedPage from '../pages/LockedPage.vue'

function mountWithRouter(currentPath = '/locked') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/locked', name: 'locked', component: LockedPage },
      { path: '/login', name: 'login', component: { template: '<div>login</div>' } },
    ],
  })
  router.push(currentPath)
  return mount(LockedPage, { global: { plugins: [createPinia(), router] } })
}

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.restoreAllMocks())

describe('LockedPage', () => {
  it('renders the lock heading and message', () => {
    const wrapper = mountWithRouter()
    expect(wrapper.text()).toContain('System locked')
    expect(wrapper.text()).toContain('The system is locked. Contact your service provider.')
  })

  it('links to the login page for the superadmin', () => {
    const wrapper = mountWithRouter()
    const link = wrapper.find('a[href="/login"]')
    expect(link.exists()).toBe(true)
    expect(link.text()).toContain('Go to login')
  })
})
