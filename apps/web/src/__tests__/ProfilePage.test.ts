import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

const me = vi.fn()
vi.mock('@/services/doctor', () => ({ me: (...a: unknown[]) => me(...a) }))

const changePassword = vi.fn()
const logout = vi.fn()
vi.mock('@/services/auth', () => ({
  login: vi.fn(),
  refresh: vi.fn(),
  logout: (...a: unknown[]) => logout(...a),
  fetchMe: vi.fn(),
  changePassword: (...a: unknown[]) => changePassword(...a),
}))

const updateTheme = vi.fn()
const updateLanguage = vi.fn()
const updateUsername = vi.fn()
vi.mock('@/services/user', () => ({
  updateTheme: (...a: unknown[]) => updateTheme(...a),
  updateLanguage: (...a: unknown[]) => updateLanguage(...a),
  updateUsername: (...a: unknown[]) => updateUsername(...a),
}))

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

import { ApiError } from '@/lib/http'
import { pickOption } from './pick-option'
import ProfilePage from '../pages/ProfilePage.vue'

beforeEach(() => {
  me.mockReset()
  changePassword.mockReset()
  logout.mockReset()
  push.mockReset()
  updateTheme.mockReset()
  updateLanguage.mockReset()
  updateUsername.mockReset()
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
      language: 'en',
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
  it('signs out of this session and sends the user to login with a notice', async () => {
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
      language: 'en',
      clinicId: 1,
      clinicName: 'Main Clinic',
    }
    auth.accessToken = 'AAA'
    changePassword.mockResolvedValue({ ...auth.user })
    const wrapper = mount(ProfilePage, { global: { plugins: [pinia] } })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('including this one')
    await wrapper.find('#current').setValue('oldpass')
    await wrapper.find('#new').setValue('newpass')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(changePassword).toHaveBeenCalledWith('oldpass', 'newpass')
    expect(logout).toHaveBeenCalled()
    expect(auth.isAuthenticated).toBe(false)
    expect(push).toHaveBeenCalledWith({ name: 'login', query: { passwordChanged: '1' } })
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('stays signed in and shows the error when the change fails', async () => {
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
      language: 'en',
      clinicId: 1,
      clinicName: 'Main Clinic',
    }
    auth.accessToken = 'AAA'
    changePassword.mockRejectedValueOnce(new ApiError('Current password is incorrect', 400))
    const wrapper = mount(ProfilePage, { global: { plugins: [pinia] } })
    await wrapper.find('#current').setValue('oldpass')
    await wrapper.find('#new').setValue('newpass')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(logout).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(auth.isAuthenticated).toBe(true)
    expect(wrapper.find('[role="alert"]').text()).toContain('Current password is incorrect')
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
      language: 'en',
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
      language: 'en',
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

describe('ProfilePage language', () => {
  const adminUser = () => ({
    id: 2,
    email: 'admin@h.com',
    username: 'admin',
    role: 'administrator' as const,
    firstName: 'Ada',
    lastName: 'Admin',
    darkMode: false,
    language: 'en' as const,
    clinicId: 1,
    clinicName: 'Main Clinic',
  })

  it('saves the picked language to the account and shows it as selected', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.user = adminUser()
    updateLanguage.mockResolvedValue({ ...auth.user, language: 'el' })
    const wrapper = mount(ProfilePage, { global: { plugins: [pinia] } })
    await flushPromises()
    expect(wrapper.find('#language').text()).toContain('English')

    await pickOption(wrapper.element, '#language', 'el')

    expect(updateLanguage).toHaveBeenCalledWith('el')
    expect(auth.user?.language).toBe('el')
    expect(wrapper.find('#language').text()).toContain('Ελληνικά')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('does not call the API when the current language is picked again', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().user = adminUser()
    const wrapper = mount(ProfilePage, { global: { plugins: [pinia] } })
    await flushPromises()

    await pickOption(wrapper.element, '#language', 'en')

    expect(updateLanguage).not.toHaveBeenCalled()
  })

  it('shows an error and keeps the old language when saving fails', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.user = adminUser()
    updateLanguage.mockRejectedValueOnce(new Error('net'))
    const wrapper = mount(ProfilePage, { global: { plugins: [pinia] } })
    await flushPromises()

    await pickOption(wrapper.element, '#language', 'el')

    expect(auth.user?.language).toBe('en')
    expect(wrapper.find('#language').text()).toContain('English')
    expect(wrapper.find('[role="alert"]').text()).toContain('Could not save language preference')
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
    language: 'en' as const,
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
      language: 'en',
      clinicId: 1,
      clinicName: 'Main Clinic',
    }
    const wrapper = mount(ProfilePage, { global: { plugins: [pinia] } })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#username').exists()).toBe(false)
    expect(updateUsername).not.toHaveBeenCalled()
  })
})

