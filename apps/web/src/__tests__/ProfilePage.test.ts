import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

const me = vi.fn()
vi.mock('@/services/doctor', () => ({ me: (...a: unknown[]) => me(...a) }))

const changePassword = vi.fn()
vi.mock('@/services/auth', () => ({
  login: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  fetchMe: vi.fn(),
  changePassword: (...a: unknown[]) => changePassword(...a),
}))

const updateTheme = vi.fn()
const updateUsername = vi.fn()
vi.mock('@/services/user', () => ({
  updateTheme: (...a: unknown[]) => updateTheme(...a),
  updateUsername: (...a: unknown[]) => updateUsername(...a),
}))

const getOpenDuty = vi.fn()
const updateOpenDutyInterval = vi.fn()
vi.mock('@/services/settings', () => ({
  getOpenDuty: (...a: unknown[]) => getOpenDuty(...a),
  updateOpenDutyInterval: (...a: unknown[]) => updateOpenDutyInterval(...a),
}))

import ProfilePage from '../pages/ProfilePage.vue'

beforeEach(() => {
  me.mockReset()
  changePassword.mockReset()
  updateTheme.mockReset()
  updateUsername.mockReset()
  getOpenDuty.mockReset()
  getOpenDuty.mockResolvedValue({ anchorDate: '2026-10-02', intervalDays: 8 })
  updateOpenDutyInterval.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('ProfilePage doctor self-view', () => {
  it('shows the on-call profile card for a doctor', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.user = {
      id: 10,
      email: 'dr@h.com',
      username: 'dr1',
      role: 'doctor',
      firstName: 'Jane',
      lastName: 'Roe',
      darkMode: false,
      clinicId: 1,
      clinicName: 'Main Clinic',
    }
    me.mockResolvedValue({
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
    })
    const wrapper = mount(ProfilePage, { global: { plugins: [pinia] } })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('My on-call profile')
    expect(wrapper.text()).toContain('Max monthly duties')
  })
})

describe('ProfilePage change password', () => {
  it('shows a visible success message and warns the current session ends', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.user = {
      id: 2,
      email: 'admin@h.com',
      username: 'admin',
      role: 'administrator',
      firstName: 'Ada',
      lastName: 'Admin',
      darkMode: false,
      clinicId: 1,
      clinicName: 'Main Clinic',
    }
    changePassword.mockResolvedValue({ user: { ...auth.user } })
    const wrapper = mount(ProfilePage, { global: { plugins: [pinia] } })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('including this one')
    await wrapper.find('#current').setValue('oldpass')
    await wrapper.find('#new').setValue('newpass')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(changePassword).toHaveBeenCalledWith('oldpass', 'newpass')
    const status = wrapper.find('[role="status"]')
    expect(status.exists()).toBe(true)
    expect(status.text()).toContain('Password updated.')
    expect(status.classes()).toContain('text-success')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
})

describe('ProfilePage dark mode', () => {
  it('toggles dark mode through the store and reflects the saved state', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.user = {
      id: 2,
      email: 'admin@h.com',
      username: 'admin',
      role: 'administrator',
      firstName: 'Ada',
      lastName: 'Admin',
      clinicId: 1,
      darkMode: false,
      clinicName: 'Main Clinic',
    }
    updateTheme.mockResolvedValue({ ...auth.user, darkMode: true })
    const wrapper = mount(ProfilePage, { global: { plugins: [pinia] } })
    await wrapper.vm.$nextTick()

    const toggle = wrapper.find('[role="switch"]')
    expect(toggle.attributes('aria-checked')).toBe('false')
    await toggle.trigger('click')
    await flushPromises()

    expect(updateTheme).toHaveBeenCalledWith(true)
    expect(auth.user?.darkMode).toBe(true)
    expect(wrapper.find('[role="switch"]').attributes('aria-checked')).toBe('true')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('shows an error and keeps the old state when saving fails', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.user = {
      id: 2,
      email: 'admin@h.com',
      username: 'admin',
      role: 'administrator',
      firstName: 'Ada',
      lastName: 'Admin',
      clinicId: 1,
      darkMode: false,
      clinicName: 'Main Clinic',
    }
    updateTheme.mockRejectedValueOnce(new Error('net'))
    const wrapper = mount(ProfilePage, { global: { plugins: [pinia] } })
    await wrapper.vm.$nextTick()

    await wrapper.find('[role="switch"]').trigger('click')
    await flushPromises()

    expect(auth.user?.darkMode).toBe(false)
    expect(wrapper.find('[role="switch"]').attributes('aria-checked')).toBe('false')
    expect(wrapper.find('[role="alert"]').text()).toContain('Could not save theme preference')
  })
})

describe('ProfilePage change username', () => {
  const doctorAuth = () => ({
    id: 10,
    email: 'dr@h.com',
    username: 'dr1',
    role: 'doctor' as const,
    firstName: 'Jane',
    lastName: 'Roe',
    darkMode: false,
    clinicId: 1,
    clinicName: 'Main Clinic',
  })

  async function mountDoctor() {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.user = doctorAuth()
    me.mockResolvedValue({})
    const wrapper = mount(ProfilePage, { global: { plugins: [pinia] } })
    await flushPromises()
    return { auth, wrapper }
  }

  it('lets a doctor change their username through the store', async () => {
    const { auth, wrapper } = await mountDoctor()
    updateUsername.mockResolvedValue({ ...auth.user, username: 'janer' })
    const input = wrapper.find('#username')
    expect((input.element as HTMLInputElement).value).toBe('dr1')
    await input.setValue('janer')
    const form = wrapper.findAll('form').find((f) => f.find('#username').exists())!
    await form.trigger('submit')
    await flushPromises()
    expect(updateUsername).toHaveBeenCalledWith('janer')
    expect(auth.user?.username).toBe('janer')
    expect(form.find('[role="status"]').text()).toContain('Username updated.')
    expect(form.find('[role="alert"]').exists()).toBe(false)
  })

  it('shows an error and keeps the old username when saving fails', async () => {
    const { auth, wrapper } = await mountDoctor()
    updateUsername.mockRejectedValueOnce(new Error('net'))
    const input = wrapper.find('#username')
    await input.setValue('janer')
    const form = wrapper.findAll('form').find((f) => f.find('#username').exists())!
    await form.trigger('submit')
    await flushPromises()
    expect(updateUsername).toHaveBeenCalledWith('janer')
    expect(auth.user?.username).toBe('dr1')
    expect(form.find('[role="alert"]').text()).toContain('Could not change username')
    expect(form.find('[role="status"]').exists()).toBe(false)
  })

  it('rejects an invalid username without calling the service', async () => {
    const { wrapper } = await mountDoctor()
    const input = wrapper.find('#username')
    await input.setValue('ab')
    const form = wrapper.findAll('form').find((f) => f.find('#username').exists())!
    await form.trigger('submit')
    await flushPromises()
    expect(updateUsername).not.toHaveBeenCalled()
    expect(form.find('[role="alert"]').text()).toContain('Invalid username')
  })

  it('hides the username card from non-doctors', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.user = {
      id: 2,
      email: 'admin@h.com',
      username: 'admin',
      role: 'administrator',
      firstName: 'Ada',
      lastName: 'Admin',
      darkMode: false,
      clinicId: 1,
      clinicName: 'Main Clinic',
    }
    const wrapper = mount(ProfilePage, { global: { plugins: [pinia] } })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#username').exists()).toBe(false)
    expect(updateUsername).not.toHaveBeenCalled()
  })
})

describe('ProfilePage on-call duty cycle', () => {
  const adminAuth = () => ({
    id: 2,
    email: 'admin@h.com',
    username: 'admin',
    role: 'administrator' as const,
    firstName: 'Ada',
    lastName: 'Admin',
    darkMode: false,
    clinicId: 1,
    clinicName: 'Main Clinic',
  })

  async function mountAdmin() {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.user = adminAuth()
    getOpenDuty.mockResolvedValue({ anchorDate: '2026-10-02', intervalDays: 8 })
    const wrapper = mount(ProfilePage, { global: { plugins: [pinia] } })
    await flushPromises()
    return { wrapper }
  }

  it('shows the cycle card with the anchor and current interval to admins', async () => {
    const { wrapper } = await mountAdmin()
    expect(getOpenDuty).toHaveBeenCalled()
    expect(wrapper.text()).toContain('On-call duty cycle')
    expect(wrapper.text()).toContain('2026-10-02')
    expect((wrapper.find('#open-duty-interval').element as HTMLInputElement).value).toBe('8')
  })

  it('saves a new interval through the service and confirms', async () => {
    updateOpenDutyInterval.mockResolvedValue({ anchorDate: '2026-10-02', intervalDays: 14 })
    const { wrapper } = await mountAdmin()
    await wrapper.find('#open-duty-interval').setValue('14')
    const form = wrapper.findAll('form').find((f) => f.find('#open-duty-interval').exists())!
    await form.trigger('submit')
    await flushPromises()
    expect(updateOpenDutyInterval).toHaveBeenCalledWith(14)
    expect(form.find('[role="status"]').text()).toContain('Interval updated.')
    expect(form.find('[role="alert"]').exists()).toBe(false)
  })

  it('rejects an invalid interval without calling the service', async () => {
    const { wrapper } = await mountAdmin()
    await wrapper.find('#open-duty-interval').setValue('0')
    const form = wrapper.findAll('form').find((f) => f.find('#open-duty-interval').exists())!
    await form.trigger('submit')
    await flushPromises()
    expect(updateOpenDutyInterval).not.toHaveBeenCalled()
    expect(form.find('[role="alert"]').exists()).toBe(true)
  })

  it('hides the cycle card from doctors', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.user = {
      id: 10,
      email: 'dr@h.com',
      username: 'dr1',
      role: 'doctor',
      firstName: 'Jane',
      lastName: 'Roe',
      darkMode: false,
      clinicId: 1,
      clinicName: 'Main Clinic',
    }
    const wrapper = mount(ProfilePage, { global: { plugins: [pinia] } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('On-call duty cycle')
    expect(getOpenDuty).not.toHaveBeenCalled()
  })
})
