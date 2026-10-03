import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { RouteLocationNormalized } from 'vue-router'
import { resolveGuard, type GuardAuth } from '../router/guard'
import { router } from '../router'
import { useAuthStore } from '../stores/auth'

function to(fullPath: string, meta: Partial<RouteLocationNormalized['meta']> = {}): RouteLocationNormalized {
  return {
    fullPath,
    path: fullPath,
    meta,
  } as RouteLocationNormalized
}

const authed = (role: 'administrator' | 'doctor' | 'superadmin'): GuardAuth => ({
  isAuthenticated: true,
  user: { role },
})

describe('resolveGuard', () => {
  it('allows public routes regardless of auth', () => {
    expect(resolveGuard(to('/login', { public: true }), { isAuthenticated: false, user: null })).toBe(true)
  })

  it('redirects unauthenticated users to /login with redirect query', () => {
    const res = resolveGuard(to('/users'), { isAuthenticated: false, user: null })
    expect(res).not.toBe(true)
    expect(res).toEqual({ name: 'login', query: { redirect: '/users' } })
  })

  it('allows an administrator on a role-gated route', () => {
    expect(resolveGuard(to('/users', { roles: ['administrator'] }), authed('administrator'))).toBe(true)
  })

  it('allows a superadmin on an administrator-only route', () => {
    expect(resolveGuard(to('/users', { roles: ['administrator'] }), authed('superadmin'))).toBe(true)
  })

  it('redirects a superadmin away from a doctor-only route to home', () => {
    const res = resolveGuard(to('/roster', { roles: ['doctor'] }), authed('superadmin'))
    expect(res).toEqual({ name: 'home' })
  })

  it('redirects an administrator away from a superadmin-only route to home', () => {
    const res = resolveGuard(to('/usage', { roles: ['superadmin'] }), authed('administrator'))
    expect(res).toEqual({ name: 'home' })
  })

  it('redirects a doctor away from an admin-only route to home', () => {
    const res = resolveGuard(to('/users', { roles: ['administrator'] }), authed('doctor'))
    expect(res).toEqual({ name: 'home' })
  })

  it('allows any authenticated user on an open route', () => {
    expect(resolveGuard(to('/profile'), authed('doctor'))).toBe(true)
  })

  it('redirects administrators away from my-availability (doctor-only)', () => {
    const resolved = router.resolve('/my-availability')
    const route = to(resolved.fullPath, resolved.meta)
    expect(resolveGuard(route, authed('administrator'))).toEqual({ name: 'home' })
    expect(resolveGuard(route, authed('doctor'))).toBe(true)
  })
})

describe('router', () => {
  it('sends an unknown path to home instead of rendering a blank page', async () => {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    auth.accessToken = 'token'
    auth.user = { role: 'doctor' } as typeof auth.user
    await router.push('/no-such-page')
    expect(router.currentRoute.value.name).toBe('home')
  })
})
