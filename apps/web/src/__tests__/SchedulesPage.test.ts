import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

const list = vi.fn()
vi.mock('@/services/schedule', () => ({
  list: (...a: unknown[]) => list(...a),
  preview: vi.fn(),
  generate: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  addDuty: vi.fn(),
  reassignDuty: vi.fn(),
  removeDuty: vi.fn(),
}))
const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
}))

import SchedulesPage from '../pages/SchedulesPage.vue'
import { pickOption } from './pick-option'
import { setTestLocale } from './i18n'

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, year: 2026, month: 8, status: 'draft', createdBy: 1,
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  list.mockReset()
  push.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('SchedulesPage', () => {
  function mountAs(role: 'doctor' | 'administrator') {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore(pinia).user = {
      id: 1,
      email: 'u@h.com',
      username: 'u1',
      role,
      firstName: 'Jane',
      lastName: 'Roe',
      darkMode: false,
      language: 'en',
      clinicId: 1,
      clinicName: 'Main Clinic',
    }
    list.mockResolvedValue([])
    return mount(SchedulesPage, { global: { plugins: [pinia] } })
  }

  it('renders the list with month label and status', async () => {
    list.mockResolvedValue([summary()])
    const wrapper = mount(SchedulesPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('August 2026')
    expect(wrapper.text()).toContain('Draft')
  })

  it('shows an error when listing fails', async () => {
    list.mockRejectedValue(new Error('boom'))
    const wrapper = mount(SchedulesPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('boom')
  })

  it('shows an empty state when there are no schedules', async () => {
    list.mockResolvedValue([])
    const wrapper = mount(SchedulesPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('No schedules yet.')
  })

  it('hides the empty state when listing fails', async () => {
    list.mockRejectedValue(new Error('boom'))
    const wrapper = mount(SchedulesPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('No schedules yet.')
  })

  it('shows createdAt as a local date, not the UTC date prefix', async () => {
    const tz = process.env.TZ
    process.env.TZ = 'Pacific/Auckland'
    try {
      // 2026-08-31T20:00Z is Sep 1 in Auckland.
      list.mockResolvedValue([summary({ createdAt: '2026-08-31T20:00:00.000Z' })])
      const wrapper = mount(SchedulesPage, { global: { plugins: [createPinia()] } })
      await flushPromises()
      const expected = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(2026, 8, 1))
      expect(wrapper.text()).toContain(expected)
      expect(wrapper.text()).not.toContain('2026-08-31')
    } finally {
      process.env.TZ = tz
    }
  })

  it('loads the list filtered by the current year by default', async () => {
    list.mockResolvedValue([summary()])
    const wrapper = mount(SchedulesPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith({ year: new Date().getFullYear() })
    expect((wrapper.find('#f-year').element as HTMLInputElement).value).toBe(
      String(new Date().getFullYear()),
    )
  })

  async function openDialog() {
    const wrapper = mountAs('administrator')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('New schedule'))!.trigger('click')
    await flushPromises()
    return document.body.querySelector('form')!
  }
  async function setYear(form: HTMLFormElement, value: string) {
    const year = form.querySelector('#g-year') as HTMLInputElement
    year.value = value
    year.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
  }

  it('Generate opens the options page for the chosen month', async () => {
    const form = await openDialog()
    await setYear(form, '2027')
    await pickOption(document.body, '#g-month', '3')

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(push).toHaveBeenCalledWith({ path: '/schedules/options', query: { year: '2027', month: '3' } })
    expect(document.body.querySelector('form')).toBeNull()
  })

  it('Generate with an invalid year shows the validation error and stays on the page', async () => {
    const form = await openDialog()
    await setYear(form, '1969')

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(push).not.toHaveBeenCalled()
    expect(form.querySelector('[role="alert"]')).not.toBeNull()
    expect(document.body.querySelector('form')).not.toBeNull()
  })

  it("hides 'New schedule' from doctors and shows it to administrators", async () => {
    const doctor = mountAs('doctor')
    await flushPromises()
    expect(doctor.findAll('button').some((b) => b.text().includes('New schedule'))).toBe(false)

    const admin = mountAs('administrator')
    await flushPromises()
    expect(admin.findAll('button').some((b) => b.text().includes('New schedule'))).toBe(true)
  })
})

describe('SchedulesPage in Greek', () => {
  it('renders the month, status, created date and empty state in the active UI language', async () => {
    setTestLocale('el')
    list.mockResolvedValue([summary({ createdAt: '2026-09-01T12:00:00.000Z' })])
    const wrapper = mount(SchedulesPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('Αύγουστος 2026')
    expect(wrapper.text()).toContain('Πρόχειρο')
    expect(wrapper.text()).toContain('1 Σεπ 2026')
    expect(wrapper.find('h1').text()).toBe('Προγράμματα')
  })
})
