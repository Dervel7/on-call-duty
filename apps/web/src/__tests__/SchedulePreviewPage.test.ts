import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'

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
const recordGeneratePress = vi.fn()
vi.mock('@/services/usage', () => ({
  recordGeneratePress: (...a: unknown[]) => recordGeneratePress(...a),
}))
const routeRef = vi.hoisted(() => ({ route: null as { query: Record<string, string> } | null }))
vi.mock('vue-router', () => ({
  useRoute: () => routeRef.route,
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

function deferred() {
  // Promise.withResolvers is unavailable under the repo's ES2022 lib target.
  let resolve!: (value: unknown) => void
  const promise = new Promise((res) => { resolve = res })
  return { promise, resolve }
}

beforeEach(() => {
  setActivePinia(createPinia())
  routeRef.route = reactive({ query: { year: '2026', month: '9' } })
  preview.mockReset()
  generate.mockReset()
  recordGeneratePress.mockReset()
  recordGeneratePress.mockResolvedValue(undefined)
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
    expect(recordGeneratePress).toHaveBeenCalledTimes(1)
    expect(generate).toHaveBeenCalled()
    const sent = generate.mock.calls[0]![2] as Array<{ date: string; doctorId: number }>
    expect(sent.length).toBe(days.length)
    expect(sent.every((a) => a.doctorId === 5)).toBe(true)
  })

  it('discards a stale preview response when the month changes', async () => {
    const first = deferred()
    const second = deferred()
    preview
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const wrapper = mount(SchedulePreviewPage)
    await flushPromises()
    expect(preview).toHaveBeenCalledTimes(1)
    routeRef.route!.query.month = '10'
    await flushPromises()
    expect(preview).toHaveBeenCalledTimes(2)
    second.resolve({ assignments: [], conflicts: [], days: daysFor(2026, 10) })
    await flushPromises()
    expect(wrapper.text()).toContain('October 2026')
    expect(wrapper.text()).toContain('31 day(s) with no doctor')
    expect(wrapper.findAll('select').length).toBe(62)
    first.resolve({ assignments: [], conflicts: [], days: daysFor(2026, 9) })
    await flushPromises()
    expect(wrapper.findAll('select').length).toBe(62)
    expect(wrapper.text()).toContain('31 day(s) with no doctor')
    expect(wrapper.text()).not.toContain('September 2026')
  })
})
