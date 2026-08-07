import type { AuthUser, LoginResponse } from '@oncall/shared'
import { apiGet, apiPost, setAccessToken } from '@/lib/http'

export async function login(identifier: string, password: string): Promise<LoginResponse> {
  const data = await apiPost<LoginResponse>('/auth/login', { identifier, password })
  setAccessToken(data.accessToken)
  return data
}

export async function refresh(): Promise<LoginResponse> {
  const data = await apiPost<LoginResponse>('/auth/refresh')
  setAccessToken(data.accessToken)
  return data
}

export async function logout(): Promise<void> {
  await apiPost<void>('/auth/logout')
  setAccessToken(null)
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
