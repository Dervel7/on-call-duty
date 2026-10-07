import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { Role } from '@oncall/shared'
import { useAuthStore } from '@/stores/auth'
import { setTestLocale } from './i18n'

vi.mock('vue-router', () => ({
  RouterLink: { template: '<a><slot /></a>' },
  useRoute: () => ({ path: '/' }),
  useRouter: () => ({ push: vi.fn() }),
}))

import AppSidebar from '../components/layout/AppSidebar.vue'

const user = (role: Role) => ({
  id: 1,
  email: 'u@h.com',
  username: 'u',
  role,
  firstName: 'U',
  lastName: 'Ser',
  darkMode: false,
  language: 'en' as const,
  clinicId: role === 'superadmin' ? null : 1,
  clinicName: 'Main Clinic',
})

const adminLabels = ['Home', 'Users', 'Availability', 'Schedules', 'Holidays', 'Rules', 'Reports', 'Profile']

type SidebarWrapper = VueWrapper<InstanceType<typeof AppSidebar>>

let wrapper: SidebarWrapper | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

// The update handlers feed emitted values back as props, as v-model would.
async function mountSidebar(role: Role, props: { open?: boolean; collapsed?: boolean } = {}): Promise<SidebarWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.user = user(role)
  auth.accessToken = 'token'
  wrapper = mount(AppSidebar, {
    props: {
      open: false,
      collapsed: false,
      ...props,
      'onUpdate:open': (open: boolean) => wrapper!.setProps({ open }),
      'onUpdate:collapsed': (collapsed: boolean) => wrapper!.setProps({ collapsed }),
    },
    attachTo: document.body,
    global: { plugins: [pinia] },
  })
  await flushPromises()
  return wrapper
}

const navLabels = (w: SidebarWrapper) => w.findAll('nav a').map((a) => a.text())

describe('AppSidebar navigation', () => {
  it('shows administrators every admin item, including Rules and Reports', async () => {
    expect(navLabels(await mountSidebar('administrator'))).toEqual(adminLabels)
  })

  it('adds the superadmin-only items for the superadmin', async () => {
    expect(navLabels(await mountSidebar('superadmin'))).toEqual([
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

  it('shows doctors only the doctor items, no Rules or Reports', async () => {
    expect(navLabels(await mountSidebar('doctor'))).toEqual(['Home', 'Duty roster', 'My availability', 'Profile'])
  })

  it('shows a manager no doctor or admin items', async () => {
    expect(navLabels(await mountSidebar('manager'))).toEqual(['Home', 'Profile'])
  })
})

describe('AppSidebar accessibility', () => {
  it('names the single nav and the logout button', async () => {
    const w = await mountSidebar('doctor')
    expect(w.findAll('nav').map((n) => n.attributes('aria-label'))).toEqual(['Main'])
    expect(w.find('button[aria-label="Logout"]').exists()).toBe(true)
  })
})

describe('AppSidebar language', () => {
  it('renders navigation, role and logout in the active UI language', async () => {
    setTestLocale('el')
    const w = await mountSidebar('doctor')
    expect(navLabels(w)).toEqual(['Αρχική', 'Πρόγραμμα εφημεριών', 'Η διαθεσιμότητά μου', 'Προφίλ'])
    expect(w.text()).toContain('ιατρός')
    expect(w.find('button[aria-label="Αποσύνδεση"]').exists()).toBe(true)
  })
})

describe('AppSidebar drawer', () => {
  it('locks page scroll and is a modal dialog while open', async () => {
    const w = await mountSidebar('doctor', { open: true })
    expect(document.body.style.overflow).toBe('hidden')
    const aside = w.find('aside')
    expect(aside.attributes('role')).toBe('dialog')
    expect(aside.attributes('aria-modal')).toBe('true')
  })

  it('closes on Escape and releases the scroll lock', async () => {
    const w = await mountSidebar('doctor', { open: true })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(w.props('open')).toBe(false)
    expect(document.body.style.overflow).toBe('')
  })

  it('closes when a destination is chosen', async () => {
    const w = await mountSidebar('doctor', { open: true })
    await w.find('nav a').trigger('click')
    expect(w.props('open')).toBe(false)
  })
})

describe('AppSidebar rail', () => {
  it('keeps every label accessible when collapsed', async () => {
    const w = await mountSidebar('administrator')
    const toggle = w.find('button[aria-controls="app-sidebar"]')
    expect(toggle.text()).toBe('Collapse sidebar')
    await toggle.trigger('click')
    expect(w.props('collapsed')).toBe(true)
    expect(toggle.text()).toBe('Expand sidebar')
    expect(navLabels(w)).toEqual(adminLabels)
  })
})
