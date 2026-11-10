import type { Language, UpdateUserRequest, User } from '@oncall/shared'
import { apiDelete, apiGet, apiPatch } from '@/lib/http'

export async function list(): Promise<User[]> {
  const { users } = await apiGet<{ users: User[] }>('/users')
  return users
}
export async function update(id: number, input: UpdateUserRequest): Promise<User> {
  const { user } = await apiPatch<{ user: User }>(`/users/${id}`, input)
  return user
}
export async function resetPassword(id: number, newPassword: string): Promise<User> {
  const { user } = await apiPatch<{ user: User }>(`/users/${id}/password`, { newPassword })
  return user
}
export async function updateTheme(darkMode: boolean): Promise<User> {
  const { user } = await apiPatch<{ user: User }>('/users/me/theme', { darkMode })
  return user
}
export async function updateLanguage(language: Language): Promise<User> {
  const { user } = await apiPatch<{ user: User }>('/users/me/language', { language })
  return user
}
export async function updateUsername(username: string): Promise<User> {
  const { user } = await apiPatch<{ user: User }>('/users/me/username', { username })
  return user
}
export async function remove(id: number): Promise<void> {
  await apiDelete<void>(`/users/${id}`)
}
