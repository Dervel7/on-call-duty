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
import { pickOption } from './pick-option'
import { setTestLocale } from './i18n'

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
    await pickOption(wrapper.element, '#f-action', 'auth.login')
    await flushPromises()
    expect(getActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'auth.login', page: 1, limit: 50 }),
    )
  })

  it('ignores a stale response that resolves after a newer one', async () => {
    let resolveFirst!: (v: PaginatedActivity) => void
    getActivity
      .mockReturnValueOnce(new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce(page({ items: [], total: 0 }))
    const wrapper = mount(ActivityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await pickOption(wrapper.element, '#f-action', 'auth.login')
    await flushPromises()
    resolveFirst(page())
    await flushPromises()
    expect(wrapper.text()).not.toContain('availability.created')
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

  it('a failed next-page load keeps the page counter on the rows still shown', async () => {
    getActivity
      .mockResolvedValueOnce(page({ items: [], total: 120, page: 1, limit: 50 }))
      .mockRejectedValueOnce(new Error('nope'))
      .mockResolvedValueOnce(page({ items: [], total: 120, page: 2, limit: 50 }))
    const wrapper = mount(ActivityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'Next')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
    // Retrying must ask for page 2 again, not skip to page 3.
    await wrapper.findAll('button').find((b) => b.text() === 'Next')!.trigger('click')
    await flushPromises()
    expect(getActivity).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, limit: 50 }))
  })

  it('a failed filter change does not leave the previous filter rows on screen', async () => {
    getActivity.mockResolvedValueOnce(page()).mockRejectedValueOnce(new Error('nope'))
    const wrapper = mount(ActivityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('availability.created')
    await pickOption(wrapper.element, '#f-action', 'auth.login')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
    expect(wrapper.text()).not.toContain('Jane Roe')
  })
})

describe('ActivityPage in Greek', () => {
  it('renders labels, role, range and active-locale time in Greek', async () => {
    setTestLocale('el')
    getActivity.mockResolvedValue(page())
    const wrapper = mount(ActivityPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('Δραστηριότητα χρηστών')
    expect(wrapper.text()).toContain('ιατρός')
    expect(wrapper.text()).toContain('Εμφάνιση 1–1 από 1')
    expect(wrapper.text()).toContain(new Date('2026-08-16T10:00:00.000Z').toLocaleString('el-GR'))
  })
})
