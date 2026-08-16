import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const list = vi.fn()
const remove = vi.fn()
vi.mock('@/services/doctor', () => ({
  list: (...a: unknown[]) => list(...a),
  get: vi.fn(),
  me: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: (...a: unknown[]) => remove(...a),
}))

import DoctorsPage from '../pages/DoctorsPage.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  list.mockReset()
  remove.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('DoctorsPage', () => {
  it('renders the doctor list on mount', async () => {
    list.mockResolvedValue([
      {
        id: 1,
        userId: 10,
        email: 'dr@h.com',
        username: 'dr1',
        firstName: 'Jane',
        lastName: 'Roe',
        isActive: true,
        maxMonthlyDuties: 7,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 2,
        userId: 11,
        email: 'off@h.com',
        username: 'dr2',
        firstName: 'John',
        lastName: 'Doe',
        isActive: false,
        maxMonthlyDuties: 5,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    const wrapper = mount(DoctorsPage, { global: { plugins: [createPinia()] } })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('dr@h.com')
    expect(wrapper.text()).toContain('Jane')
    const rows = wrapper.findAll('tr')
    expect(rows[1]!.classes()).not.toContain('bg-destructive/10')
    expect(rows[2]!.classes()).toContain('bg-destructive/10')
  })

  it('shows an error message when listing fails', async () => {
    list.mockRejectedValue(new Error('nope'))
    const wrapper = mount(DoctorsPage, { global: { plugins: [createPinia()] } })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
  })

  it('Delete button asks for confirmation and calls remove', async () => {
    list.mockResolvedValueOnce([
      {
        id: 1,
        userId: 10,
        email: 'dr@h.com',
        username: 'dr1',
        firstName: 'Jane',
        lastName: 'Roe',
        isActive: true,
        maxMonthlyDuties: 7,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    list.mockResolvedValue([]) // reload after delete
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = mount(DoctorsPage, { global: { plugins: [createPinia()] } })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const btn = wrapper
      .findAll('button')
      .find((b) => b.text() === 'Delete')
    await btn!.trigger('click')
    await wrapper.vm.$nextTick()
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('permanently hidden'),
    )
    expect(remove).toHaveBeenCalledWith(1)
    confirmSpy.mockRestore()
  })
})
