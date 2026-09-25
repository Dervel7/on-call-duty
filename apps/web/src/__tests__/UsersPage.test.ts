import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const list = vi.fn()
const create = vi.fn()
const update = vi.fn()
const remove = vi.fn()
const resetPassword = vi.fn()
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
  resetPassword: (...a: unknown[]) => resetPassword(...a),
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
import { pickOption } from './pick-option'
import type { User } from '@oncall/shared'

const { settle } = useConfirmState()

beforeEach(() => {
  setActivePinia(createPinia())
  list.mockReset()
  create.mockReset()
  update.mockReset()
  remove.mockReset()
  resetPassword.mockReset()
  doctorList.mockReset().mockResolvedValue([])
  doctorCreate.mockReset()
  doctorUpdate.mockReset()
  doctorRemove.mockReset()
  settle(false)
})
afterEach(() => vi.restoreAllMocks())

const doctorUser: User = {
  id: 1,
  email: 'dr@h.com',
  username: 'drroe',
  role: 'doctor',
  firstName: 'Jane',
  lastName: 'Roe',
  isActive: true,
  darkMode: false,
  clinicId: 1,
  clinicName: 'Main Clinic',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const adminUser: User = {
  id: 2,
  email: 'a@b.com',
  username: 'admin',
  role: 'administrator',
  firstName: 'Ada',
  lastName: 'Ops',
  isActive: true,
  createdAt: '2026-01-02T00:00:00.000Z',
  darkMode: false,
  clinicId: 1,
  clinicName: 'Main Clinic',
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

describe('UsersPage', () => {
  it('renders doctors with duty caps and hides administrators', async () => {
    list.mockResolvedValue([doctorUser, adminUser])
    doctorList.mockResolvedValue([doctorProfile])
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('dr@h.com')
    expect(wrapper.text()).toContain('Jane')
    expect(wrapper.text()).toContain('5')
    expect(wrapper.text()).not.toContain('a@b.com')
    expect(wrapper.text()).not.toContain('administrator')
  })

  it('shows only doctors, hiding every non-doctor including the own account', async () => {
    const otherAdmin: User = { ...adminUser, id: 3, email: 'other@h.com', username: 'other' }
    const boss: User = { ...adminUser, id: 4, email: 'boss@h.com', username: 'boss', role: 'superadmin' }
    list.mockResolvedValue([otherAdmin, boss, doctorUser, adminUser])
    doctorList.mockResolvedValue([doctorProfile])
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(wrapper.text()).toContain('dr@h.com')
    expect(wrapper.text()).not.toContain('a@b.com')
    expect(wrapper.text()).not.toContain('other@h.com')
    expect(wrapper.text()).not.toContain('boss@h.com')
    wrapper.unmount()
  })

  it('sorts by last name and keeps that order after disabling a doctor', async () => {
    const aaa: User = { ...doctorUser, id: 11, email: 'aaa@h.com', firstName: 'Zoe', lastName: 'Aaa' }
    const zzz: User = { ...doctorUser, id: 12, email: 'zzz@h.com', firstName: 'Amy', lastName: 'Zzz' }
    list.mockResolvedValueOnce([doctorUser, zzz, aaa])
    list.mockResolvedValueOnce([zzz, { ...doctorUser, isActive: false }, aaa])
    doctorList.mockResolvedValue([])
    update.mockResolvedValue(doctorUser)
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    const emails = () => wrapper.findAll('tbody tr').map((r) => r.findAll('td')[1]?.text())
    expect(emails()).toEqual(['aaa@h.com', 'dr@h.com', 'zzz@h.com'])
    await wrapper.findAll('button').find((b) => b.text() === 'Disable')!.trigger('click')
    await flushPromises()
    expect(update).toHaveBeenCalledWith(11, { isActive: false })
    expect(emails()).toEqual(['aaa@h.com', 'dr@h.com', 'zzz@h.com'])
    wrapper.unmount()
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
    await pickOption(document.body, '#e-role', 'doctor')
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
    list.mockResolvedValue([doctorUser])
    doctorList.mockResolvedValue([doctorProfile])
    doctorUpdate.mockRejectedValue(new Error('dup'))
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'Edit')!.trigger('click')
    await flushPromises()
    bodyButton('Save')!.click()
    await flushPromises()
    expect(doctorUpdate).toHaveBeenCalledWith(10, expect.objectContaining({ email: 'dr@h.com' }))
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
    list.mockResolvedValue([doctorUser])
    doctorList.mockResolvedValue([doctorProfile])
    doctorRemove.mockRejectedValue(new Error('gone'))
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(1)
    await wrapper.findAll('button').find((b) => b.text() === 'Delete')!.trigger('click')
    await flushPromises()
    settle(true)
    await flushPromises()
    expect(doctorRemove).toHaveBeenCalledWith(10)
    expect(wrapper.find('[role="alert"]').text()).toContain('gone')
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('shows a Reset Password button only in the edit dialog of an existing user', async () => {
    list.mockResolvedValue([doctorUser])
    doctorList.mockResolvedValue([doctorProfile])
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'New user')!.trigger('click')
    await flushPromises()
    expect(bodyButton('Reset Password')).toBeUndefined()
    await wrapper.findAll('button').find((b) => b.text() === 'Edit')!.trigger('click')
    await flushPromises()
    expect(bodyButton('Reset Password')).toBeTruthy()
    wrapper.unmount()
  })

  it('resets the password through the service and closes only the reset dialog', async () => {
    list.mockResolvedValue([doctorUser])
    doctorList.mockResolvedValue([doctorProfile])
    resetPassword.mockResolvedValue(doctorUser)
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'Edit')!.trigger('click')
    await flushPromises()
    bodyButton('Reset Password')!.click()
    await flushPromises()
    setBodyValue('#r-password', 'newsecret')
    await flushPromises()
    bodyButton('Confirm')!.click()
    await flushPromises()
    expect(resetPassword).toHaveBeenCalledWith(1, 'newsecret')
    expect(document.body.querySelector('#r-password')).toBeNull()
    expect(bodyButton('Save')).toBeTruthy()
    wrapper.unmount()
  })

  it('shows an inline error for a short password without calling the service', async () => {
    list.mockResolvedValue([doctorUser])
    doctorList.mockResolvedValue([doctorProfile])
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'Edit')!.trigger('click')
    await flushPromises()
    bodyButton('Reset Password')!.click()
    await flushPromises()
    setBodyValue('#r-password', 'abc')
    await flushPromises()
    bodyButton('Confirm')!.click()
    await flushPromises()
    expect(resetPassword).not.toHaveBeenCalled()
    expect(document.body.querySelector('#r-password')).toBeTruthy()
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBeTruthy()
    wrapper.unmount()
  })

  it('keeps the reset dialog open with an inline error when the reset fails', async () => {
    list.mockResolvedValue([doctorUser])
    doctorList.mockResolvedValue([doctorProfile])
    resetPassword.mockRejectedValue(new Error('weak'))
    const wrapper = mount(UsersPage, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text() === 'Edit')!.trigger('click')
    await flushPromises()
    bodyButton('Reset Password')!.click()
    await flushPromises()
    setBodyValue('#r-password', 'newsecret')
    await flushPromises()
    bodyButton('Confirm')!.click()
    await flushPromises()
    expect(resetPassword).toHaveBeenCalledWith(1, 'newsecret')
    expect(document.body.querySelector('#r-password')).toBeTruthy()
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('weak')
    wrapper.unmount()
  })
})
