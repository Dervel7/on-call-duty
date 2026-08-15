import type { RouteLocationNormalized, RouteLocationRaw } from 'vue-router'
import type { Role } from '@oncall/shared'

export interface GuardAuth {
  isAuthenticated: boolean
  user: { role: Role } | null
}

function isRoleAllowed(roles: Role[], role: Role): boolean {
  if (roles.includes(role)) return true
  return role === 'superadmin' && roles.includes('administrator')
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
  if (roles && (auth.user === null || !isRoleAllowed(roles, auth.user.role))) {
    return { name: 'home' }
  }
  return true
}
