import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const list = vi.fn()
const create = vi.fn()
const update = vi.fn()
const remove = vi.fn()
vi.mock('@/services/doctor', () => ({
  list: (...a: unknown[]) => list(...a),
  get: vi.fn(),
  me: vi.fn(),
  create: (...a: unknown[]) => create(...a),
  update: (...a: unknown[]) => update(...a),
  remove: (...a: unknown[]) => remove(...a),
}))

import DoctorsPage from '../pages/DoctorsPage.vue'
import { useConfirmState } from '../composables/useConfirm'

const { request, settle } = useConfirmState()

beforeEach(() => {
  setActivePinia(createPinia())
  list.mockReset()
  create.mockReset()
  update.mockReset()
  remove.mockReset()
  settle(false)
})
afterEach(() => vi.restoreAllMocks())

const doctor = {
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
    const wrapper = mount(DoctorsPage, { global: { plugins: [createPinia()] } })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const btn = wrapper
      .findAll('button')
      .find((b) => b.text() === 'Delete')
    await btn!.trigger('click')
    await wrapper.vm.$nextTick()
    expect(request.value?.title).toBe('Delete doctor')
    expect(request.value?.message).toContain('permanently hidden')
    settle(false)
    await flushPromises()
    expect(remove).not.toHaveBeenCalled()
    await btn!.trigger('click')
    settle(true)
    await flushPromises()
    expect(remove).toHaveBeenCalledWith(1)
  })

  it('keeps the dialog open with an inline error when create fails', async () => {
    list.mockResolvedValue([])
    create.mockRejectedValue(new Error('dup'))
    const wrapper = mount(DoctorsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'New doctor')!.trigger('click')
    await flushPromises()
    setBodyValue('#d-email', 'dr@h.com')
    setBodyValue('#d-username', 'dr1')
    setBodyValue('#d-first', 'Jane')
    setBodyValue('#d-last', 'Roe')
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
    list.mockResolvedValue([doctor])
    update.mockRejectedValue(new Error('dup'))
    const wrapper = mount(DoctorsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'Edit')!.trigger('click')
    await flushPromises()
    bodyButton('Save')!.click()
    await flushPromises()
    expect(update).toHaveBeenCalledWith(1, expect.objectContaining({ email: 'dr@h.com' }))
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('dup')
    expect(bodyButton('Save')).toBeTruthy()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows a dialog-level validation error and skips the service on invalid input', async () => {
    list.mockResolvedValue([])
    const wrapper = mount(DoctorsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'New doctor')!.trigger('click')
    await flushPromises()
    setBodyValue('#d-email', 'not-an-email')
    setBodyValue('#d-username', 'dr1')
    setBodyValue('#d-first', 'Jane')
    setBodyValue('#d-last', 'Roe')
    await flushPromises()
    bodyButton('Save')!.click()
    await flushPromises()
    expect(create).not.toHaveBeenCalled()
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBeTruthy()
    expect(bodyButton('Save')).toBeTruthy()
    wrapper.unmount()
  })

  it('shows a page-level error when toggling active fails and does not reload', async () => {
    list.mockResolvedValue([doctor])
    update.mockRejectedValue(new Error('boom'))
    const wrapper = mount(DoctorsPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(1)
    await wrapper.findAll('button').find((b) => b.text() === 'Disable')!.trigger('click')
    await flushPromises()
    expect(update).toHaveBeenCalledWith(1, { isActive: false })
    expect(wrapper.find('[role="alert"]').text()).toContain('boom')
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('shows a page-level error when a confirmed delete fails and does not reload', async () => {
    list.mockResolvedValue([doctor])
    remove.mockRejectedValue(new Error('gone'))
    const wrapper = mount(DoctorsPage, { global: { plugins: [createPinia()] } })
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
