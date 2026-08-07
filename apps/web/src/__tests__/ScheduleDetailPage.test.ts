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

function detail(status: 'draft' | 'published') {
  return {
    schedule: {
      id: 1,
      year: 2026,
      month: 9,
      status,
      createdBy: 1,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    duties: [
      {
        id: 10,
        scheduleId: 1,
        dutyDate: '2026-09-05',
        doctorId: 5,
        doctorFirstName: 'Jane',
        doctorLastName: 'Roe',
        isWeekend: false,
        isHoliday: false,
        reason: 'score 1',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ],
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  get.mockReset()
  publish.mockReset()
  unpublish.mockReset()
  doctorList.mockResolvedValue([])
})
afterEach(() => vi.restoreAllMocks())

describe('ScheduleDetailPage', () => {
  it('renders the day-list with the assigned doctor and Edit action', async () => {
    get.mockResolvedValue(detail('draft'))
    const wrapper = mount(ScheduleDetailPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('September 2026')
    expect(wrapper.text()).toContain('Jane Roe')
    expect(wrapper.text()).toContain('Edit')
  })

  it('locks override actions when the schedule is published', async () => {
    get.mockResolvedValue(detail('published'))
    const wrapper = mount(ScheduleDetailPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('Published')
    expect(wrapper.text()).toContain('Locked')
    expect(wrapper.text()).toContain('Revert to draft')
    expect(wrapper.text()).not.toContain('+ Add')
  })

  it('publish flips status and locks editing', async () => {
    get.mockResolvedValue(detail('draft'))
    publish.mockResolvedValue({
      id: 1, year: 2026, month: 9, status: 'published', createdBy: 1, createdAt: '', updatedAt: '',
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = mount(ScheduleDetailPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('Edit')

    await wrapper.findAll('button').find((b) => b.text().includes('Publish'))!.trigger('click')
    await flushPromises()
    expect(publish).toHaveBeenCalledWith(1)
    expect(wrapper.text()).toContain('Locked')
    expect(wrapper.text()).not.toContain('+ Add')
  })
})
