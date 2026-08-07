import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const list = vi.fn()
vi.mock('@/services/holiday', () => ({
  list: (...a: unknown[]) => list(...a),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

import HolidaysPage from '../pages/HolidaysPage.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  list.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('HolidaysPage', () => {
  it('renders the list on mount', async () => {
    list.mockResolvedValue([
      { id: 1, name: 'Sample Holiday', date: '2026-09-01', createdAt: '', updatedAt: '' },
    ])
    const wrapper = mount(HolidaysPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('Sample Holiday')
    expect(wrapper.text()).toContain('2026-09-01')
  })

  it('shows an error when listing fails', async () => {
    list.mockRejectedValue(new Error('nope'))
    const wrapper = mount(HolidaysPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
  })
})
