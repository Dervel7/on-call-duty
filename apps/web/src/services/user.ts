import type { CreateUserRequest, UpdateUserRequest, User } from '@oncall/shared'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/http'

export async function list(clinicId?: number): Promise<User[]> {
  const qs = clinicId !== undefined ? `?clinicId=${clinicId}` : ''
  const { users } = await apiGet<{ users: User[] }>(`/users${qs}`)
  return users
}
export async function get(id: number): Promise<User> {
  const { user } = await apiGet<{ user: User }>(`/users/${id}`)
  return user
}
export async function create(input: CreateUserRequest): Promise<User> {
  const { user } = await apiPost<{ user: User }>('/users', input)
  return user
}
export async function update(id: number, input: UpdateUserRequest): Promise<User> {
  const { user } = await apiPatch<{ user: User }>(`/users/${id}`, input)
  return user
}
export async function updateTheme(darkMode: boolean): Promise<User> {
  const { user } = await apiPatch<{ user: User }>('/users/me/theme', { darkMode })
  return user
}
export async function remove(id: number): Promise<void> {
  await apiDelete<void>(`/users/${id}`)
}
