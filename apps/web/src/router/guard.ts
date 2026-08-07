import type { RouteLocationNormalized, RouteLocationRaw } from 'vue-router'
import type { Role } from '@oncall/shared'

export interface GuardAuth {
  isAuthenticated: boolean
  user: { role: Role } | null
}

export function resolveGuard(
  to: RouteLocationNormalized,
  auth: GuardAuth,
): true | RouteLocationRaw {
  if (to.meta.public) return true
  if (!auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  const roles = to.meta.roles
  if (roles && (auth.user === null || !roles.includes(auth.user.role))) {
    return { name: 'home' }
  }
  return true
}
