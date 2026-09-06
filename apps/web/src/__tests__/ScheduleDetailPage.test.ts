import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const get = vi.fn()
const publish = vi.fn()
const unpublish = vi.fn()
const addDuty = vi.fn()
const reassignDuty = vi.fn()
const removeDuty = vi.fn()
vi.mock('@/services/schedule', () => ({
  list: vi.fn(),
  preview: vi.fn(),
  generate: vi.fn(),
  get: (...a: unknown[]) => get(...a),
  remove: vi.fn(),
  publish: (...a: unknown[]) => publish(...a),
  unpublish: (...a: unknown[]) => unpublish(...a),
  addDuty: (...a: unknown[]) => addDuty(...a),
  reassignDuty: (...a: unknown[]) => reassignDuty(...a),
  removeDuty: (...a: unknown[]) => removeDuty(...a),
}))
const doctorList = vi.fn()
vi.mock('@/services/doctor', () => ({
  list: (...a: unknown[]) => doctorList(...a),
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '1' } }),
  useRouter: () => ({ push: vi.fn() }),
}))

import ScheduleDetailPage from '../pages/ScheduleDetailPage.vue'
import { useAuthStore } from '../stores/auth'

function daysFor(year: number, month: number) {
  const total = new Date(year, month, 0).getDate()
  return Array.from({ length: total }, (_, i) => {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`
    const dow = new Date(`${iso}T00:00:00`).getDay()
    return { date: iso, isWeekend: dow === 0 || dow === 6, eligibleDoctorIds: [5], availableDoctorIds: [5] }
  })
}

function detail(status: 'draft' | 'published') {
  return {
    schedule: {
      id: 1, year: 2026, month: 9, status, createdBy: 1,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    },
    duties: [
      {
        id: 10, scheduleId: 1, dutyDate: '2026-09-05', doctorId: 5,
        doctorFirstName: 'Jane', doctorLastName: 'Roe',
        isWeekend: false, reason: 'score 1',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ],
    days: daysFor(2026, 9),
  }
}

function mountAs(role: 'administrator' | 'doctor' = 'administrator') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.user = {
    id: 1, role, email: 'a@b.c', username: 'a', firstName: 'A', lastName: 'B', isActive: true,
  } as never
  auth.accessToken = 'x'
  return mount(ScheduleDetailPage, { global: { plugins: [pinia] } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  get.mockReset()
  publish.mockReset()
  unpublish.mockReset()
  addDuty.mockReset()
  reassignDuty.mockReset()
  removeDuty.mockReset()
  doctorList.mockResolvedValue([
    { id: 5, userId: 5, email: 'j@b.c', username: 'j', firstName: 'Jane', lastName: 'Roe', isActive: true, maxMonthlyDuties: 7, createdAt: '', updatedAt: '' },
  ])
})
afterEach(() => vi.restoreAllMocks())

describe('ScheduleDetailPage', () => {
  it('renders the calendar with the assigned doctor (admin, draft, editable)', async () => {
    get.mockResolvedValue(detail('draft'))
    const wrapper = mountAs('administrator')
    await flushPromises()
    expect(wrapper.text()).toContain('September 2026')
    expect(wrapper.text()).toContain('Roe J.')
    expect(wrapper.findAll('select').length).toBeGreaterThan(0)
  })

  it('locks to read-only when published (no selects)', async () => {
    get.mockResolvedValue(detail('published'))
    const wrapper = mountAs('administrator')
    await flushPromises()
    expect(wrapper.text()).toContain('Published')
    expect(wrapper.text()).toContain('Revert to draft')
    expect(wrapper.findAll('select').length).toBe(0)
  })

  it('doctor sees read-only names even when doctor list is forbidden (no selects, no publish buttons)', async () => {
    get.mockResolvedValue(detail('published'))
    doctorList.mockRejectedValue(new Error('Forbidden'))
    const wrapper = mountAs('doctor')
    await flushPromises()
    expect(wrapper.text()).toContain('Roe J.')
    expect(wrapper.findAll('select').length).toBe(0)
    expect(wrapper.text()).not.toContain('Revert to draft')
  })

  it('adds a duty via the inline select and reloads', async () => {
    get.mockResolvedValueOnce(detail('draft'))
    addDuty.mockResolvedValue({ id: 99 } as never)
    get.mockResolvedValue(detail('draft'))
    const wrapper = mountAs('administrator')
    await flushPromises()
    const select = wrapper.find('select')
    await select.setValue('5')
    await flushPromises()
    expect(addDuty).toHaveBeenCalledWith(1, { date: '2026-09-01', doctorId: 5 })
    expect(get).toHaveBeenCalledTimes(2)
  })
})
