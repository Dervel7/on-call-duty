import { describe, expect, it } from 'vitest'
import type { RouteLocationNormalized } from 'vue-router'
import { resolveGuard, type GuardAuth } from '../router/guard'

function to(fullPath: string, meta: Partial<RouteLocationNormalized['meta']> = {}): RouteLocationNormalized {
  return {
    fullPath,
    path: fullPath,
    meta,
  } as RouteLocationNormalized
}

const authed = (role: 'administrator' | 'doctor' | 'superadmin' | 'manager'): GuardAuth => ({
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

  it('allows a manager on every drill-down route', () => {
    const drillDown = ['/schedules', '/schedules/12', '/roster', '/reports', '/activity', '/users', '/availability']
    for (const path of drillDown) {
      expect(resolveGuard(to(path, { roles: ['administrator', 'doctor', 'manager'] }), authed('manager'))).toBe(true)
    }
  })

  it('redirects a manager away from preview and usage to home', () => {
    expect(resolveGuard(to('/schedules/preview', { roles: ['administrator'] }), authed('manager'))).toEqual({ name: 'home' })
    expect(resolveGuard(to('/usage', { roles: ['superadmin'] }), authed('manager'))).toEqual({ name: 'home' })
  })

  it('allows a manager on the clinics route; superadmin is locked out of it', () => {
    expect(resolveGuard(to('/clinics', { roles: ['manager'] }), authed('manager'))).toBe(true)
    expect(resolveGuard(to('/clinics', { roles: ['manager'] }), authed('superadmin'))).toEqual({ name: 'home' })
  })

  it('superadmin still passes administrator-gated routes after the manager widening', () => {
    expect(
      resolveGuard(to('/users', { roles: ['administrator', 'manager'] }), authed('superadmin')),
    ).toBe(true)
  })
})
