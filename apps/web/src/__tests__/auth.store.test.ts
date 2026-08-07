import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

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

import { useAuthStore } from '../stores/auth'

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
})
