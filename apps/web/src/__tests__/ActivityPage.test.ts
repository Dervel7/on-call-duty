import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { PaginatedActivity } from '@oncall/shared'

const getActivity = vi.fn()
vi.mock('@/services/activity', () => ({
  getActivity: (...a: unknown[]) => getActivity(...a),
}))
const listUsers = vi.fn()
vi.mock('@/services/user', () => ({
  list: (...a: unknown[]) => listUsers(...a),
}))

import ActivityPage from '../pages/ActivityPage.vue'

function page(overrides: Record<string, unknown> = {}): PaginatedActivity {
  return {
    items: [
      {
        id: 1,
        action: 'availability.created',
        entityType: 'unavailability',
        entityId: 12,
        detail: { type: 'vacation', startDate: '2026-09-07', endDate: '2026-09-11' },
        createdAt: '2026-08-16T10:00:00.000Z',
        actor: {
          id: 3,
          username: 'jroe',
          role: 'doctor',
          firstName: 'Jane',
          lastName: 'Roe',
        },
      },
    ],
    total: 1,
    page: 1,
    limit: 50,
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  getActivity.mockReset()
  listUsers.mockReset()
  listUsers.mockResolvedValue([])
})
afterEach(() => vi.restoreAllMocks())

describe('ActivityPage', () => {
  it('renders entries on mount', async () => {
    getActivity.mockResolvedValue(page())
    const wrapper = mount(ActivityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('availability.created')
    expect(wrapper.text()).toContain('Jane Roe')
    expect(wrapper.text()).toContain('unavailability #12')
    expect(wrapper.text()).toContain('Showing 1–1 of 1')
  })

  it('renders "Deleted user" for a null actor', async () => {
    const p = page()
    p.items[0]!.actor = null
    getActivity.mockResolvedValue(p)
    const wrapper = mount(ActivityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('Deleted user')
  })

  it('refetches with the selected action filter', async () => {
    getActivity.mockResolvedValue(page())
    const wrapper = mount(ActivityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    const select = wrapper.find('#f-action')
    await select.setValue('auth.login')
    await flushPromises()
    expect(getActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'auth.login', page: 1, limit: 50 }),
    )
  })

  it('paginates forward and back', async () => {
    getActivity.mockResolvedValue(page({ items: [], total: 120, page: 1, limit: 50 }))
    const wrapper = mount(ActivityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    const buttons = wrapper.findAll('button')
    const next = buttons.find((b) => b.text() === 'Next')!
    await next.trigger('click')
    await flushPromises()
    expect(getActivity).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, limit: 50 }))
  })

  it('shows an error when loading fails', async () => {
    getActivity.mockRejectedValue(new Error('nope'))
    const wrapper = mount(ActivityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
  })
})
