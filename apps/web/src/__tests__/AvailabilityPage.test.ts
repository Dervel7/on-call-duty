import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const listAll = vi.fn()
vi.mock('@/services/unavailability', () => ({
  listAll: (...a: unknown[]) => listAll(...a),
  listMine: vi.fn(),
  createForDoctor: vi.fn(),
  createMine: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))
const doctorList = vi.fn()
vi.mock('@/services/doctor', () => ({
  list: (...a: unknown[]) => doctorList(...a),
  get: vi.fn(),
  me: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

import AvailabilityPage from '../pages/AvailabilityPage.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  listAll.mockReset()
  doctorList.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('AvailabilityPage', () => {
  it('renders the list on mount', async () => {
    doctorList.mockResolvedValue([])
    listAll.mockResolvedValue([
      {
        id: 1,
        doctorId: 5,
        doctorFirstName: 'Jane',
        doctorLastName: 'Roe',
        type: 'vacation',
        startDate: '2026-09-07',
        endDate: '2026-09-11',
        note: 'Summer break',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ])
    const wrapper = mount(AvailabilityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('Jane')
    expect(wrapper.text()).toContain('2026-09-07')
  })

  it('shows an error when listing fails', async () => {
    doctorList.mockResolvedValue([])
    listAll.mockRejectedValue(new Error('nope'))
    const wrapper = mount(AvailabilityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
  })
})
