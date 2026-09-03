import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
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
import { useConfirmState } from '../composables/useConfirm'

const { settle } = useConfirmState()

beforeEach(() => {
  setActivePinia(createPinia())
  list.mockReset()
  create.mockReset()
  update.mockReset()
  remove.mockReset()
  settle(false)
})
afterEach(() => vi.restoreAllMocks())

const user = {
  id: 1,
  email: 'a@b.com',
  username: 'admin',
  role: 'doctor',
  firstName: 'Jane',
  lastName: 'Roe',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
}

function bodyButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(label),
  )
}

function setBodyValue(selector: string, value: string) {
  const el = document.body.querySelector(selector) as HTMLInputElement
  el.value = value
  el.dispatchEvent(new Event('input'))
}

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

  it('keeps the dialog open with an inline error when create fails', async () => {
    list.mockResolvedValue([])
    create.mockRejectedValue(new Error('dup'))
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'New user')!.trigger('click')
    await flushPromises()
    setBodyValue('#e-email', 'ops@h.com')
    setBodyValue('#e-username', 'admin1')
    setBodyValue('#e-first', 'Ada')
    setBodyValue('#e-last', 'Ops')
    await flushPromises()
    bodyButton('Save')!.click()
    await flushPromises()
    expect(create).toHaveBeenCalledTimes(1)
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('dup')
    expect(bodyButton('Save')).toBeTruthy()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps the dialog open with an inline error when update fails', async () => {
    list.mockResolvedValue([user])
    update.mockRejectedValue(new Error('dup'))
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'Edit')!.trigger('click')
    await flushPromises()
    bodyButton('Save')!.click()
    await flushPromises()
    expect(update).toHaveBeenCalledWith(1, expect.objectContaining({ email: 'a@b.com' }))
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('dup')
    expect(bodyButton('Save')).toBeTruthy()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows a dialog-level validation error and skips the service on invalid input', async () => {
    list.mockResolvedValue([])
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'New user')!.trigger('click')
    await flushPromises()
    setBodyValue('#e-email', 'not-an-email')
    setBodyValue('#e-username', 'admin1')
    setBodyValue('#e-first', 'Ada')
    setBodyValue('#e-last', 'Ops')
    await flushPromises()
    bodyButton('Save')!.click()
    await flushPromises()
    expect(create).not.toHaveBeenCalled()
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBeTruthy()
    expect(bodyButton('Save')).toBeTruthy()
    wrapper.unmount()
  })

  it('shows a page-level error when toggling active fails and does not reload', async () => {
    list.mockResolvedValue([user])
    update.mockRejectedValue(new Error('boom'))
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(1)
    await wrapper.findAll('button').find((b) => b.text() === 'Disable')!.trigger('click')
    await flushPromises()
    expect(update).toHaveBeenCalledWith(1, { isActive: false })
    expect(wrapper.find('[role="alert"]').text()).toContain('boom')
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('shows a page-level error when a confirmed delete fails and does not reload', async () => {
    list.mockResolvedValue([user])
    remove.mockRejectedValue(new Error('gone'))
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(1)
    await wrapper.findAll('button').find((b) => b.text() === 'Delete')!.trigger('click')
    settle(true)
    await flushPromises()
    expect(remove).toHaveBeenCalledWith(1)
    expect(wrapper.find('[role="alert"]').text()).toContain('gone')
    expect(list).toHaveBeenCalledTimes(1)
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
