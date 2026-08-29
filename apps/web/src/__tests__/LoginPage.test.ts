import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
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

function mountWithRouter(currentPath = '/login') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div>home</div>' } },
      { path: '/login', name: 'login', component: LoginPage },
    ],
  })
  router.push(currentPath)
  return mount(LoginPage, { global: { plugins: [createPinia(), router] } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  login.mockReset()
})
afterEach(() => vi.restoreAllMocks())

describe('LoginPage', () => {
  it('shows a friendly error when fields are empty', async () => {
    login.mockResolvedValue(undefined)
    const wrapper = mountWithRouter()
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
    const wrapper = mountWithRouter()
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
    const wrapper = mountWithRouter()
    const inputs = wrapper.findAll('input')
    await inputs[0]!.setValue('a@b.com')
    await inputs[1]!.setValue('secret1')
    await wrapper.find('form').trigger('submit.prevent')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(login).toHaveBeenCalledWith('a@b.com', 'secret1')
    expect(wrapper.find('[role="alert"]').text()).toContain('Invalid credentials')
  })
})
