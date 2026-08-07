import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const list = vi.fn()
const create = vi.fn()
const update = vi.fn()
const remove = vi.fn()

vi.mock('@/services/user', () => ({
  list: (...a: unknown[]) => list(...a),
  get: vi.fn(),
  create: (...a: unknown[]) => create(...a),
  update: (...a: unknown[]) => update(...a),
  remove: (...a: unknown[]) => remove(...a),
}))

import UsersPage from '../pages/UsersPage.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  list.mockReset()
  create.mockReset()
  update.mockReset()
  remove.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('UsersPage', () => {
  it('renders the user list on mount', async () => {
    list.mockResolvedValue([
      {
        id: 1,
        email: 'a@b.com',
        username: 'admin',
        role: 'doctor',
        firstName: 'Jane',
        lastName: 'Roe',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('a@b.com')
    expect(wrapper.text()).toContain('Jane')
  })

  it('shows an error message when listing fails', async () => {
    list.mockRejectedValue(new Error('nope'))
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
  })
})

describe('UsersPage create narrowing', () => {
  it('create dialog is titled "New administrator" with no role selector for new users', async () => {
    list.mockResolvedValue([])
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await wrapper.vm.$nextTick()
    const openBtn = wrapper.findAll('button').find((b) => b.text().includes('New user'))
    expect(openBtn).toBeTruthy()
    await openBtn?.trigger('click')
    await wrapper.vm.$nextTick()
    // The Dialog teleports to document.body, so query the document, not wrapper.
    expect(document.body.textContent).toContain('New administrator')
    expect(document.querySelector('#e-role')).toBeNull()
  })
})
