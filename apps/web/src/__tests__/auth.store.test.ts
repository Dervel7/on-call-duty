import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { SYSTEM_LOCKED_MESSAGE } from '@oncall/shared'

vi.mock('@/services/auth', () => ({
  login: vi.fn(async () => ({
    user: { id: 1, email: 'a@b.com', username: 'admin', role: 'administrator', firstName: 'A', lastName: 'B' },
    accessToken: 'AAA',
  })),
  refresh: vi.fn(async () => ({
    user: { id: 1, email: 'a@b.com', username: 'admin', role: 'doctor', firstName: 'A', lastName: 'B' },
    accessToken: 'BBB',
  })),
  logout: vi.fn(async () => undefined),
  fetchMe: vi.fn(async () => ({
    id: 1,
    email: 'a@b.com',
    username: 'admin',
    role: 'doctor',
    firstName: 'A',
    lastName: 'B',
  })),
  changePassword: vi.fn(async () => ({
    id: 1,
    email: 'a@b.com',
    username: 'admin',
    role: 'doctor',
    firstName: 'A',
    lastName: 'B',
  })),
}))

const updateTheme = vi.fn()
vi.mock('@/services/user', () => ({ updateTheme: (...a: unknown[]) => updateTheme(...a) }))

import { createMemoryHistory, createRouter } from 'vue-router'

// The store reaches the router lazily; give it a real in-memory one to land on.
const testRouter = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/login', name: 'login', component: { template: '<div />' } },
    { path: '/locked', name: 'locked', component: { template: '<div />' } },
    { path: '/doctors', name: 'doctors', component: { template: '<div />' } },
  ],
})
vi.mock('@/router', () => ({ router: testRouter }))

import { useAuthStore } from '../stores/auth'
import { apiGet } from '../lib/http'
import { logout as logoutService, refresh as refreshService } from '@/services/auth'

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.restoreAllMocks())

describe('auth store', () => {
  it('login sets user + token and reports authenticated', async () => {
    const auth = useAuthStore()
    expect(auth.isAuthenticated).toBe(false)
    await auth.login('a@b.com', 'secret1')
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.isAdmin).toBe(true)
    expect(auth.accessToken).toBe('AAA')
  })

  it('refresh failure clears auth and resolves null', async () => {
    const auth = useAuthStore()
    const { refresh } = await import('@/services/auth')
    vi.mocked(refresh).mockRejectedValueOnce(new Error('boom'))
    const token = await auth.refresh()
    expect(token).toBeNull()
    expect(auth.isAuthenticated).toBe(false)
  })

  it('logout clears auth even if the service throws', async () => {
    const auth = useAuthStore()
    await auth.login('a@b.com', 'secret1')
    const { logout } = await import('@/services/auth')
    vi.mocked(logout).mockRejectedValueOnce(new Error('net'))
    await auth.logout()
    expect(auth.isAuthenticated).toBe(false)
  })

  it('login and refresh give the http module the token; logout removes it', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    try {
      const auth = useAuthStore()
      const header = async () => {
        fetchMock.mockClear()
        await apiGet('/doctors')
        return (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>
      }
      await auth.login('a@b.com', 'secret1')
      expect((await header()).Authorization).toBe('Bearer AAA')
      await auth.refresh()
      expect((await header()).Authorization).toBe('Bearer BBB')
      await auth.logout()
      expect(await header()).not.toHaveProperty('Authorization')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a failed logout stops later requests from sending the old token', async () => {
    const auth = useAuthStore()
    await auth.login('a@b.com', 'secret1')
    vi.mocked(logoutService).mockRejectedValueOnce(new Error('net'))
    await auth.logout()
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    try {
      await apiGet('/doctors')
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit
      expect(init.headers).not.toHaveProperty('Authorization')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('setDarkMode persists the preference and updates the stored user', async () => {
    const auth = useAuthStore()
    await auth.login('a@b.com', 'secret1')
    expect(auth.user?.darkMode ?? false).toBe(false)
    updateTheme.mockResolvedValue({ ...auth.user, darkMode: true })
    await auth.setDarkMode(true)
    expect(updateTheme).toHaveBeenCalledWith(true)
    expect(auth.user?.darkMode).toBe(true)
  })

  describe('when the session expires mid-request', () => {
    beforeEach(async () => {
      await testRouter.push('/doctors?page=2')
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401 })),
      )
    })
    afterEach(() => vi.unstubAllGlobals())

    it('a 401 followed by a failed refresh ends on the login route', async () => {
      const auth = useAuthStore()
      await auth.login('a@b.com', 'secret1')
      vi.mocked(refreshService).mockRejectedValueOnce(new Error('expired'))
      await expect(apiGet('/doctors')).rejects.toThrow()
      await vi.waitFor(() => expect(testRouter.currentRoute.value.name).toBe('login'))
      expect(testRouter.currentRoute.value.query.redirect).toBe('/doctors?page=2')
      expect(auth.isAuthenticated).toBe(false)
    })

    it('a failed bootstrap refresh stays put', async () => {
      const auth = useAuthStore()
      vi.mocked(refreshService).mockRejectedValueOnce(new Error('no cookie'))
      await auth.refresh()
      await flushPromises()
      expect(testRouter.currentRoute.value.name).toBe('doctors')
    })

    it('a 401 whose refresh is rejected as system-locked ends on the locked route', async () => {
      const auth = useAuthStore()
      await auth.login('a@b.com', 'secret1')
      vi.mocked(refreshService).mockImplementationOnce(async () => {
        // The real service goes through request(), which fires the locked handler on this 403.
        vi.stubGlobal(
          'fetch',
          vi.fn(
            async () =>
              new Response(JSON.stringify({ success: false, error: SYSTEM_LOCKED_MESSAGE }), { status: 403 }),
          ),
        )
        return apiGet('/auth/refresh')
      })
      await expect(apiGet('/doctors')).rejects.toThrow()
      await vi.waitFor(() => expect(testRouter.currentRoute.value.name).toBe('locked'))
      await flushPromises()
      expect(testRouter.currentRoute.value.name).toBe('locked')
      expect(auth.locked).toBe(true)
    })
  })
})
