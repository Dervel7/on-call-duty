import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const list = vi.fn()
vi.mock('@/services/schedule', () => ({
  list: (...a: unknown[]) => list(...a),
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

import ScheduleRosterPage from '../pages/ScheduleRosterPage.vue'
import { setTestLocale } from './i18n'

beforeEach(() => list.mockReset())
afterEach(() => vi.restoreAllMocks())

describe('ScheduleRosterPage', () => {
  it('shows the error instead of the empty state when loading fails', async () => {
    list.mockRejectedValue(new Error('server down'))
    const wrapper = mount(ScheduleRosterPage)
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('server down')
    expect(wrapper.text()).not.toContain('No published schedules yet.')
  })

  it('shows the empty state when there are no published schedules', async () => {
    list.mockResolvedValue([])
    const wrapper = mount(ScheduleRosterPage)
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('No published schedules yet.')
  })
})

describe('ScheduleRosterPage in Greek', () => {
  it('renders the month and actions in the active UI language', async () => {
    setTestLocale('el')
    list.mockResolvedValue([{ id: 3, year: 2026, month: 8, status: 'published', createdBy: 1, createdAt: '', updatedAt: '' }])
    const wrapper = mount(ScheduleRosterPage)
    await flushPromises()
    expect(wrapper.text()).toContain('Αύγουστος 2026')
    expect(wrapper.find('button').text()).toBe('Προβολή')
  })

  it('renders the empty state in the active UI language', async () => {
    setTestLocale('el')
    list.mockResolvedValue([])
    const wrapper = mount(ScheduleRosterPage)
    await flushPromises()
    expect(wrapper.text()).toContain('Δεν υπάρχουν ακόμη δημοσιευμένα προγράμματα.')
  })
})
