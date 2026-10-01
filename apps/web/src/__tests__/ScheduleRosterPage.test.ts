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
