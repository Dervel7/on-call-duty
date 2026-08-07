import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const list = vi.fn()
vi.mock('@/services/doctor', () => ({
  list: (...a: unknown[]) => list(...a),
  get: vi.fn(),
  me: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

import DoctorsPage from '../pages/DoctorsPage.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  list.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('DoctorsPage', () => {
  it('renders the doctor list on mount', async () => {
    list.mockResolvedValue([
      {
        id: 1,
        userId: 10,
        email: 'dr@h.com',
        firstName: 'Jane',
        lastName: 'Roe',
        isActive: true,
        maxMonthlyDuties: 7,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    const wrapper = mount(DoctorsPage, { global: { plugins: [createPinia()] } })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('dr@h.com')
    expect(wrapper.text()).toContain('Jane')
  })

  it('shows an error message when listing fails', async () => {
    list.mockRejectedValue(new Error('nope'))
    const wrapper = mount(DoctorsPage, { global: { plugins: [createPinia()] } })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
  })
})
