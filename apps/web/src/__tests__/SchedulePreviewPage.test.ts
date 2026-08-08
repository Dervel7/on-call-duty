import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const preview = vi.fn()
const generate = vi.fn()
vi.mock('@/services/schedule', () => ({
  preview: (...a: unknown[]) => preview(...a),
  generate: (...a: unknown[]) => generate(...a),
  list: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  addDuty: vi.fn(),
  reassignDuty: vi.fn(),
  removeDuty: vi.fn(),
}))
const doctorList = vi.fn()
vi.mock('@/services/doctor', () => ({
  list: (...a: unknown[]) => doctorList(...a),
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: { year: '2026', month: '9' } }),
  useRouter: () => ({ push: vi.fn() }),
}))

import SchedulePreviewPage from '../pages/SchedulePreviewPage.vue'

function daysFor(year: number, month: number) {
  const total = new Date(year, month, 0).getDate()
  return Array.from({ length: total }, (_, i) => {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`
    const dow = new Date(`${iso}T00:00:00`).getDay()
    return {
      date: iso,
      isWeekend: dow === 0 || dow === 6,
      isHoliday: false,
      eligibleDoctorIds: [],
      availableDoctorIds: [5, 6],
    }
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  preview.mockReset()
  generate.mockReset()
  doctorList.mockResolvedValue([
    { id: 5, userId: 5, email: 'j@b.c', username: 'j', firstName: 'Jane', lastName: 'Roe', isActive: true, maxMonthlyDuties: 7, createdAt: '', updatedAt: '' },
    { id: 6, userId: 6, email: 's@b.c', username: 's', firstName: 'Sam', lastName: 'Doe', isActive: true, maxMonthlyDuties: 7, createdAt: '', updatedAt: '' },
  ])
})
afterEach(() => vi.restoreAllMocks())

describe('SchedulePreviewPage', () => {
  it('renders editable calendar (selects present)', async () => {
    preview.mockResolvedValue({ assignments: [], conflicts: [], days: daysFor(2026, 9) })
    const wrapper = mount(SchedulePreviewPage)
    await flushPromises()
    expect(wrapper.text()).toContain('September 2026')
    expect(wrapper.findAll('select').length).toBeGreaterThan(0)
  })

  it('blocks Generate while any day has no doctor; shows error banner', async () => {
    preview.mockResolvedValue({ assignments: [], conflicts: [], days: daysFor(2026, 9) })
    const wrapper = mount(SchedulePreviewPage)
    await flushPromises()
    const button = wrapper.findAll('button').find((b) => b.text().includes('Generate'))!
    expect(button.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('day(s) with no doctor')
  })

  it('assigning one doctor per day via selects enables Generate and sends the plan', async () => {
    const days = daysFor(2026, 9)
    preview.mockResolvedValue({ assignments: [], conflicts: [], days })
    generate.mockResolvedValue({
      schedule: { id: 42, year: 2026, month: 9, status: 'draft', createdBy: 1, createdAt: '', updatedAt: '' },
      duties: [],
      days,
    })
    const wrapper = mount(SchedulePreviewPage)
    await flushPromises()
    const selects = wrapper.findAll('select')
    for (const sel of selects) {
      await sel.setValue('5')
    }
    await flushPromises()
    const button = wrapper.findAll('button').find((b) => b.text().includes('Generate'))!
    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click')
    await flushPromises()
    expect(generate).toHaveBeenCalled()
    const sent = generate.mock.calls[0]![2] as Array<{ date: string; doctorId: number }>
    expect(sent.length).toBe(days.length)
    expect(sent.every((a) => a.doctorId === 5)).toBe(true)
  })
})
