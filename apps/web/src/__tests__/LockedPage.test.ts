import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { SYSTEM_LOCKED_MESSAGE } from '@oncall/shared'
import LockedPage from '../pages/LockedPage.vue'
import { setTestLocale } from './i18n'

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
    expect(wrapper.text()).toContain(SYSTEM_LOCKED_MESSAGE)
  })

  it('links to the login page for the superadmin', () => {
    const wrapper = mountWithRouter()
    const link = wrapper.find('a[href="/login"]')
    expect(link.exists()).toBe(true)
    expect(link.text()).toContain('Go to login')
  })

  it('renders the heading, message and link in the active UI language', () => {
    setTestLocale('el')
    const wrapper = mountWithRouter()
    expect(wrapper.find('.font-display').text()).toBe('Το σύστημα είναι κλειδωμένο')
    expect(wrapper.text()).toContain('Επικοινωνήστε με τον πάροχο υπηρεσιών σας.')
    expect(wrapper.find('a[href="/login"]').text()).toContain('Μετάβαση στη σύνδεση')
  })
})
