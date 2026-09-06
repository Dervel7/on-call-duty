import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const list = vi.fn()
const create = vi.fn()
const update = vi.fn()
const remove = vi.fn()
const doctorList = vi.fn()
const doctorCreate = vi.fn()
const doctorUpdate = vi.fn()
const doctorRemove = vi.fn()

vi.mock('@/services/user', () => ({
  list: (...a: unknown[]) => list(...a),
  get: vi.fn(),
  create: (...a: unknown[]) => create(...a),
  update: (...a: unknown[]) => update(...a),
  remove: (...a: unknown[]) => remove(...a),
}))

vi.mock('@/services/doctor', () => ({
  list: (...a: unknown[]) => doctorList(...a),
  get: vi.fn(),
  me: vi.fn(),
  create: (...a: unknown[]) => doctorCreate(...a),
  update: (...a: unknown[]) => doctorUpdate(...a),
  remove: (...a: unknown[]) => doctorRemove(...a),
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
  doctorList.mockReset().mockResolvedValue([])
  doctorCreate.mockReset()
  doctorUpdate.mockReset()
  doctorRemove.mockReset()
  settle(false)
})
afterEach(() => vi.restoreAllMocks())

const doctorUser = {
  id: 1,
  email: 'dr@h.com',
  username: 'drroe',
  role: 'doctor',
  firstName: 'Jane',
  lastName: 'Roe',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const adminUser = {
  id: 2,
  email: 'a@b.com',
  username: 'admin',
  role: 'administrator',
  firstName: 'Ada',
  lastName: 'Ops',
  isActive: true,
  createdAt: '2026-01-02T00:00:00.000Z',
}

const doctorProfile = {
  id: 10,
  userId: 1,
  email: 'dr@h.com',
  username: 'drroe',
  firstName: 'Jane',
  lastName: 'Roe',
  isActive: true,
  maxMonthlyDuties: 5,
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

function setBodySelect(selector: string, value: string) {
  const el = document.body.querySelector(selector) as HTMLSelectElement
  el.value = value
  el.dispatchEvent(new Event('change'))
}

describe('UsersPage', () => {
  it('renders users with role, doctor duty caps and admin placeholders', async () => {
    list.mockResolvedValue([doctorUser, adminUser])
    doctorList.mockResolvedValue([doctorProfile])
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('dr@h.com')
    expect(wrapper.text()).toContain('Jane')
    expect(wrapper.text()).toContain('administrator')
    expect(wrapper.text()).toContain('5')
    expect(wrapper.text()).toContain('—')
  })

  it('shows an error message when listing fails', async () => {
    list.mockRejectedValue(new Error('nope'))
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('nope')
  })

  it('creates an administrator through the user service by default', async () => {
    list.mockResolvedValue([])
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
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ops@h.com', role: 'administrator' }),
    )
    expect(doctorCreate).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('creates a doctor with the duty cap through the doctor service', async () => {
    list.mockResolvedValue([])
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'New user')!.trigger('click')
    await flushPromises()
    expect(document.body.querySelector('#e-max')).toBeNull()
    setBodySelect('#e-role', 'doctor')
    await flushPromises()
    setBodyValue('#e-email', 'dr@h.com')
    setBodyValue('#e-username', 'drsmith')
    setBodyValue('#e-first', 'Al')
    setBodyValue('#e-last', 'Smith')
    setBodyValue('#e-max', '4')
    await flushPromises()
    bodyButton('Save')!.click()
    await flushPromises()
    expect(doctorCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'dr@h.com',
        password: 'dr@h.com',
        maxMonthlyDuties: 4,
      }),
    )
    expect(create).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('updates a doctor profile through the doctor service', async () => {
    list.mockResolvedValue([doctorUser])
    doctorList.mockResolvedValue([doctorProfile])
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'Edit')!.trigger('click')
    await flushPromises()
    expect((document.body.querySelector('#e-role') as HTMLSelectElement).disabled).toBe(true)
    setBodyValue('#e-max', '6')
    await flushPromises()
    bodyButton('Save')!.click()
    await flushPromises()
    expect(doctorUpdate).toHaveBeenCalledWith(10, expect.objectContaining({ maxMonthlyDuties: 6 }))
    expect(update).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('updates a non-doctor user through the user service', async () => {
    list.mockResolvedValue([adminUser])
    update.mockResolvedValue(adminUser)
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'Edit')!.trigger('click')
    await flushPromises()
    expect((document.body.querySelector('#e-role') as HTMLSelectElement).disabled).toBe(true)
    bodyButton('Save')!.click()
    await flushPromises()
    expect(update).toHaveBeenCalledWith(2, expect.objectContaining({ email: 'a@b.com' }))
    expect(doctorUpdate).not.toHaveBeenCalled()
    wrapper.unmount()
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
    list.mockResolvedValue([adminUser])
    update.mockRejectedValue(new Error('dup'))
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'Edit')!.trigger('click')
    await flushPromises()
    bodyButton('Save')!.click()
    await flushPromises()
    expect(update).toHaveBeenCalledWith(2, expect.objectContaining({ email: 'a@b.com' }))
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
    list.mockResolvedValue([doctorUser])
    doctorList.mockResolvedValue([doctorProfile])
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

  it('deletes a doctor through the doctor service after confirmation', async () => {
    list.mockResolvedValue([doctorUser])
    doctorList.mockResolvedValue([doctorProfile])
    doctorRemove.mockResolvedValue(undefined)
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'Delete')!.trigger('click')
    await flushPromises()
    settle(true)
    await flushPromises()
    expect(doctorRemove).toHaveBeenCalledWith(10)
    expect(remove).not.toHaveBeenCalled()
  })

  it('shows a page-level error when a confirmed delete fails and does not reload', async () => {
    list.mockResolvedValue([adminUser])
    remove.mockRejectedValue(new Error('gone'))
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(1)
    await wrapper.findAll('button').find((b) => b.text() === 'Delete')!.trigger('click')
    await flushPromises()
    settle(true)
    await flushPromises()
    expect(remove).toHaveBeenCalledWith(2)
    expect(wrapper.find('[role="alert"]').text()).toContain('gone')
    expect(list).toHaveBeenCalledTimes(1)
  })
})
