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

const route = { query: {} as Record<string, string> }
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => route,
}))

const clinicsList = vi.fn()
vi.mock('@/services/clinics', () => ({
  list: (...a: unknown[]) => clinicsList(...a),
  create: vi.fn(),
  update: vi.fn(),
}))

import ActivityPage from '../pages/ActivityPage.vue'
import { useAuthStore } from '../stores/auth'
import { pickOption } from './pick-option'

function mountAsManager() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore(pinia).user = {
    id: 1,
    email: 'm@oncall.local',
    username: 'manager',
    role: 'manager',
    firstName: 'Max',
    lastName: 'Manager',
    darkMode: false,
    clinicId: null,
    clinicName: null,
  }
  clinicsList.mockResolvedValue([
    { id: 1, name: 'Radiology', isActive: true, doctorCount: 3, adminCount: 1 },
    { id: 2, name: 'Cardiology', isActive: true, doctorCount: 3, adminCount: 1 },
  ])
  return mount(ActivityPage, { global: { plugins: [pinia] } })
}

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
  route.query = {}
  getActivity.mockReset()
  listUsers.mockReset()
  listUsers.mockResolvedValue([])
  clinicsList.mockReset()
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

  it('manager mode: log and user filter scoped to the selected clinic', async () => {
    route.query = { clinic: '2' }
    getActivity.mockResolvedValue(page())
    const wrapper = mountAsManager()
    await flushPromises()
    expect(wrapper.find('[data-testid="clinic-selector"]').exists()).toBe(true)
    expect(getActivity).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 2, page: 1, limit: 50 }))
    expect(listUsers).toHaveBeenCalledWith(2)
  })

  it('manager mode without a clinic selection skips the fetch', async () => {
    const wrapper = mountAsManager()
    await flushPromises()
    expect(getActivity).not.toHaveBeenCalled()
    expect(listUsers).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Select a clinic above to view its activity.')
  })
})
