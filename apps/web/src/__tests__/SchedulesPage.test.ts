import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { ApiError } from '@/lib/http'

const list = vi.fn()
const generate = vi.fn()
vi.mock('@/services/schedule', () => ({
  list: (...a: unknown[]) => list(...a),
  preview: vi.fn(),
  generate: (...a: unknown[]) => generate(...a),
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
  generate.mockReset()
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

  it('Generate creates the schedule and opens its plan', async () => {
    const wrapper = mountAs('administrator')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('New schedule'))!.trigger('click')
    await flushPromises()

    const dialogButtons = Array.from(document.body.querySelectorAll('button'))
      .map((b) => b.textContent ?? '')
    expect(dialogButtons.some((t) => t.includes('Preview'))).toBe(false)

    const form = document.body.querySelector('form')!
    const year = form.querySelector('#g-year') as HTMLInputElement
    year.value = '2027'
    year.dispatchEvent(new Event('input', { bubbles: true }))
    const month = form.querySelector('#g-month') as HTMLSelectElement
    month.value = '3'
    month.dispatchEvent(new Event('change', { bubbles: true }))

    generate.mockResolvedValue({ schedule: { id: 7 } })
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(generate).toHaveBeenCalledWith(2027, 3)
    expect(push).toHaveBeenCalledWith('/schedules/7')
    expect(document.body.querySelector('form')).toBeNull()
  })

  it('Generate with unfillable days opens the preview to resolve conflicts', async () => {
    const wrapper = mountAs('administrator')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('New schedule'))!.trigger('click')
    await flushPromises()

    const form = document.body.querySelector('form')!
    const year = form.querySelector('#g-year') as HTMLInputElement
    year.value = '2027'
    year.dispatchEvent(new Event('input', { bubbles: true }))
    const month = form.querySelector('#g-month') as HTMLSelectElement
    month.value = '3'
    month.dispatchEvent(new Event('change', { bubbles: true }))

    generate.mockRejectedValue(
      new ApiError(
        'Schedule has 4 unfillable day(s); Preview the schedule and resolve conflicts before generating a plan',
        422,
      ),
    )
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(push).toHaveBeenCalledWith({
      path: '/schedules/preview',
      query: { year: '2027', month: '3' },
    })
    expect(document.body.querySelector('form')).toBeNull()
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
