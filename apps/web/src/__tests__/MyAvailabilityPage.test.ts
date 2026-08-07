import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const listMine = vi.fn()
vi.mock('@/services/unavailability', () => ({
  listAll: vi.fn(),
  listMine: (...a: unknown[]) => listMine(...a),
  createForDoctor: vi.fn(),
  createMine: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

import MyAvailabilityPage from '../pages/MyAvailabilityPage.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  listMine.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('MyAvailabilityPage', () => {
  it('renders own records on mount', async () => {
    listMine.mockResolvedValue([
      {
        id: 1,
        doctorId: 5,
        doctorFirstName: 'Jane',
        doctorLastName: 'Roe',
        type: 'sick',
        startDate: '2026-09-15',
        endDate: '2026-09-15',
        note: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ])
    const wrapper = mount(MyAvailabilityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('sick')
    expect(wrapper.text()).toContain('2026-09-15')
  })

  it('shows an error when listing fails', async () => {
    listMine.mockRejectedValue(new Error('nope'))
    const wrapper = mount(MyAvailabilityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
  })
})
