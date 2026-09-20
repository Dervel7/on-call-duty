import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from '../App.vue'
import { useAuthStore } from '@/stores/auth'
import type { AuthUser } from '@oncall/shared'

const stub = { template: '<div>page</div>' }

function darkUser(darkMode: boolean): AuthUser {
  return {
    id: 1,
    email: 'a@b.c',
    username: 'admin',
    role: 'administrator',
    firstName: 'A',
    lastName: 'B',
    darkMode,
    clinicId: 1,
    clinicName: 'Main Clinic',
  }
}

function mountApp() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: stub },
      { path: '/login', name: 'login', component: stub, meta: { public: true } },
    ],
  })
  router.push('/')
  mount(App, { global: { plugins: [pinia, router] } })
  return { auth: useAuthStore(), router }
}

afterEach(() => {
  document.documentElement.classList.remove('dark')
})

describe('app theme', () => {
  it('applies dark when the signed-in user prefers dark mode', async () => {
    const { auth, router } = mountApp()
    await router.isReady()
    auth.user = darkUser(true)
    await nextTick()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('stays light when the user prefers light', async () => {
    const { auth, router } = mountApp()
    await router.isReady()
    auth.user = darkUser(false)
    await nextTick()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('forces light on the public login route regardless of preference', async () => {
    const { auth, router } = mountApp()
    await router.isReady()
    // Navigate like the real app: the initial navigation lands on a private
    // route, then the guard redirects unauthenticated users to /login.
    await router.push('/login')
    auth.user = darkUser(true)
    await nextTick()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('returns to light after sign-out', async () => {
    const { auth, router } = mountApp()
    await router.isReady()
    auth.user = darkUser(true)
    await nextTick()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    auth.user = null
    await nextTick()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
