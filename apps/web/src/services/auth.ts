import type { AuthUser, LoginResponse } from '@oncall/shared'
import { apiGet, apiPost } from '@/lib/http'

export function login(identifier: string, password: string): Promise<LoginResponse> {
  return apiPost<LoginResponse>('/auth/login', { identifier, password })
}

// Tabs share one refresh cookie and the API revokes the whole session family when a rotated
// token is reused, so refreshes are serialised across tabs: the second one sends the new cookie.
export async function refresh(): Promise<LoginResponse> {
  const post = () => apiPost<LoginResponse>('/auth/refresh')
  return navigator.locks ? navigator.locks.request('oncall-auth-refresh', post) : post()
}

export async function logout(): Promise<void> {
  await apiPost<void>('/auth/logout')
}

export async function fetchMe(): Promise<AuthUser> {
  const { user } = await apiGet<{ user: AuthUser }>('/auth/me')
  return user
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<AuthUser> {
  const { user } = await apiPost<{ user: AuthUser }>('/auth/change-password', {
    currentPassword,
    newPassword,
  })
  return user
}
