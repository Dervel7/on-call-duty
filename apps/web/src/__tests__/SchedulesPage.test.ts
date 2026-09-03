import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { ApiError } from '@/lib/http'

const list = vi.fn()
const generate = vi.fn()
const recordGeneratePress = vi.fn()
vi.mock('@/services/usage', () => ({
  recordGeneratePress: (...a: unknown[]) => recordGeneratePress(...a),
}))
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
  recordGeneratePress.mockReset()
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
    recordGeneratePress.mockResolvedValue(undefined)
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

  it('dialog has no Preview button; Generate records a press before generating', async () => {
    generate.mockResolvedValue({
      schedule: { id: 7, year: 2026, month: 9, status: 'draft', createdBy: 1, createdAt: '', updatedAt: '' },
      duties: [],
      days: [],
    })
    const wrapper = mountAs('administrator')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('New schedule'))!.trigger('click')
    await flushPromises()
    const buttons = Array.from(document.body.querySelectorAll('button'))
    expect(buttons.some((b) => b.textContent?.includes('Preview'))).toBe(false)
    const generateBtn = buttons.find((b) => b.textContent?.includes('Generate'))
    expect(generateBtn).toBeTruthy()
    generateBtn!.click()
    await flushPromises()
    expect(recordGeneratePress).toHaveBeenCalledTimes(1)
    expect(generate).toHaveBeenCalledWith(expect.any(Number), expect.any(Number))
    expect(push).toHaveBeenCalledWith('/schedules/7')
  })

  it("hides 'New schedule' from doctors and shows it to administrators", async () => {
    const doctor = mountAs('doctor')
    await flushPromises()
    expect(doctor.findAll('button').some((b) => b.text().includes('New schedule'))).toBe(false)

    const admin = mountAs('administrator')
    await flushPromises()
    expect(admin.findAll('button').some((b) => b.text().includes('New schedule'))).toBe(true)
  })

  it('navigates to the preview page when generate fails with 422', async () => {
    generate.mockRejectedValue(new ApiError('Month cannot be filled', 422))
    const wrapper = mountAs('administrator')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('New schedule'))!.trigger('click')
    await flushPromises()
    const generateBtn = Array.from(document.body.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Generate'))
    expect(generateBtn).toBeTruthy()
    generateBtn!.click()
    await flushPromises()
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/schedules/preview', query: expect.anything() }),
    )
  })

  it('non-422 failures keep the dialog open and show the error', async () => {
    generate.mockRejectedValue(
      new ApiError('Schedule already exists for this month; delete it first', 409),
    )
    const wrapper = mountAs('administrator')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('New schedule'))!.trigger('click')
    await flushPromises()
    const generateBtn = Array.from(document.body.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Generate'))
    expect(generateBtn).toBeTruthy()
    generateBtn!.click()
    await flushPromises()
    expect(push).not.toHaveBeenCalled()
    const alert = document.body.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('Schedule already exists for this month')
  })
})
