import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AuthUser } from '@oncall/shared'
import { setRefreshHandler } from '@/lib/http'
import * as authService from '@/services/auth'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const accessToken = ref<string | null>(null)

  const isAuthenticated = computed(() => accessToken.value !== null)
  const isAdmin = computed(() => user.value?.role === 'administrator')

  async function login(identifier: string, password: string): Promise<void> {
    const data = await authService.login(identifier, password)
    user.value = data.user
    accessToken.value = data.accessToken
  }

  async function refresh(): Promise<string | null> {
    try {
      const data = await authService.refresh()
      user.value = data.user
      accessToken.value = data.accessToken
      return data.accessToken
    } catch {
      user.value = null
      accessToken.value = null
      return null
    }
  }

  async function logout(): Promise<void> {
    try {
      await authService.logout()
    } catch {
    } finally {
      user.value = null
      accessToken.value = null
    }
  }

  async function fetchMe(): Promise<void> {
    user.value = await authService.fetchMe()
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    user.value = await authService.changePassword(currentPassword, newPassword)
  }

  setRefreshHandler(refresh)

  return { user, accessToken, isAuthenticated, isAdmin, login, refresh, logout, fetchMe, changePassword }
})
