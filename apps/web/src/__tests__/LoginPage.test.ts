import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import LoginPage from '../pages/LoginPage.vue'

const login = vi.fn()
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: null,
    accessToken: null,
    isAuthenticated: false,
    isAdmin: false,
    login,
    refresh: vi.fn(),
    logout: vi.fn(),
    fetchMe: vi.fn(),
    changePassword: vi.fn(),
  }),
}))

async function mountWithRouter(currentPath = '/login') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div>home</div>' } },
      { path: '/login', name: 'login', component: LoginPage },
      { path: '/team', name: 'team', component: { template: '<div>team</div>' } },
    ],
  })
  // Finish navigating before install, or the router's initial navigation to '/' wins.
  await router.push(currentPath)
  const wrapper = mount(LoginPage, { global: { plugins: [createPinia(), router] } })
  return { wrapper, router }
}

async function submitValid(wrapper: VueWrapper) {
  const inputs = wrapper.findAll('input')
  await inputs[0]!.setValue('a@b.com')
  await inputs[1]!.setValue('secret1')
  await wrapper.find('form').trigger('submit.prevent')
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  login.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('LoginPage', () => {
  it('shows a friendly error when fields are empty', async () => {
    login.mockResolvedValue(undefined)
    const { wrapper } = await mountWithRouter()
    const inputs = wrapper.findAll('input')
    await inputs[0]!.setValue('')
    await inputs[1]!.setValue('')
    await wrapper.find('form').trigger('submit.prevent')
    await wrapper.vm.$nextTick()
    expect(login).not.toHaveBeenCalled()
    expect(wrapper.find('[role="alert"]').text()).toContain('Username and Password must not be empty')
  })

  it('shows a validation error when the password is too short', async () => {
    login.mockResolvedValue(undefined)
    const { wrapper } = await mountWithRouter()
    const inputs = wrapper.findAll('input')
    await inputs[0]!.setValue('a@b.com')
    await inputs[1]!.setValue('123')
    await wrapper.find('form').trigger('submit.prevent')
    await wrapper.vm.$nextTick()
    expect(login).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('Sign in succeeded')
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })

  it('calls the store and shows a server error on failure', async () => {
    const { ApiError } = await import('@/lib/http')
    login.mockRejectedValue(new ApiError('Invalid credentials', 401))
    const { wrapper } = await mountWithRouter()
    const inputs = wrapper.findAll('input')
    await inputs[0]!.setValue('a@b.com')
    await inputs[1]!.setValue('secret1')
    await wrapper.find('form').trigger('submit.prevent')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(login).toHaveBeenCalledWith('a@b.com', 'secret1')
    expect(wrapper.find('[role="alert"]').text()).toContain('Invalid credentials')
  })

  it('tells the user to sign in again after a password change', async () => {
    const { wrapper } = await mountWithRouter('/login?passwordChanged=1')
    expect(wrapper.find('[role="status"]').text()).toContain('Password changed, please sign in again.')
  })

  it('shows no password notice on a plain visit', async () => {
    const { wrapper } = await mountWithRouter('/login')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('honors a same-origin redirect after login', async () => {
    login.mockResolvedValue(undefined)
    const { wrapper, router } = await mountWithRouter('/login?redirect=/team')
    await submitValid(wrapper)
    expect(router.currentRoute.value.path).toBe('/team')
  })

  it.each([
    ['protocol-relative', '/login?redirect=//evil.com'],
    ['array', '/login?redirect=/team&redirect=/x'],
    ['absolute URL', '/login?redirect=https://evil.com'],
  ])('falls back to / for a %s redirect', async (_label, path) => {
    login.mockResolvedValue(undefined)
    const { wrapper, router } = await mountWithRouter(path)
    await submitValid(wrapper)
    expect(router.currentRoute.value.path).toBe('/')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
})
