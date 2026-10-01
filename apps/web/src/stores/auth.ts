import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AuthUser } from '@oncall/shared'
import { setAccessToken, setLockedHandler, setRefreshHandler } from '@/lib/http'
import * as authService from '@/services/auth'
import * as userService from '@/services/user'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const accessToken = ref<string | null>(null)

  const isAuthenticated = computed(() => accessToken.value !== null)
  const isAdmin = computed(
    () => user.value?.role === 'administrator' || user.value?.role === 'superadmin',
  )
  const isSuperadmin = computed(() => user.value?.role === 'superadmin')

  async function login(identifier: string, password: string): Promise<void> {
    const data = await authService.login(identifier, password)
    user.value = data.user
    accessToken.value = data.accessToken
  }

  /** Clears the store and the token the http module sends, so the two never drift. */
  function clearSession(): void {
    user.value = null
    accessToken.value = null
    setAccessToken(null)
  }

  async function refresh(): Promise<string | null> {
    try {
      const data = await authService.refresh()
      user.value = data.user
      accessToken.value = data.accessToken
      return data.accessToken
    } catch {
      clearSession()
      return null
    }
  }

  async function logout(): Promise<void> {
    try {
      await authService.logout()
    } catch {
    } finally {
      clearSession()
    }
  }

  async function fetchMe(): Promise<void> {
    user.value = await authService.fetchMe()
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    user.value = await authService.changePassword(currentPassword, newPassword)
  }

  async function setDarkMode(darkMode: boolean): Promise<void> {
    const updated = await userService.updateTheme(darkMode)
    // Keep the stored AuthUser shape; only the preference changes.
    if (user.value) user.value = { ...user.value, darkMode: updated.darkMode }
  }

  async function setUsername(username: string): Promise<void> {
    const updated = await userService.updateUsername(username)
    // Keep the stored AuthUser shape; only the username changes.
    if (user.value) user.value = { ...user.value, username: updated.username }
  }

  // A refresh that fails mid-request means the session is gone: send the user to sign in.
  // The bootstrap refresh in main.ts calls refresh() directly and must not redirect.
  setRefreshHandler(async () => {
    const token = await refresh()
    if (token === null) {
      import('@/router')
        .then(({ router }) => {
          const current = router.currentRoute.value
          if (current.name === 'login') return
          return router.push({ name: 'login', query: { redirect: current.fullPath } })
        })
        .catch(() => {})
    }
    return token
  })

  setLockedHandler(() => {
    clearSession()
    import('@/router')
      .then(({ router }) => router.push({ name: 'locked' }))
      .catch(() => {})
  })

  return {
    user,
    accessToken,
    isAuthenticated,
    isAdmin,
    isSuperadmin,
    login,
    refresh,
    logout,
    fetchMe,
    changePassword,
    setDarkMode,
    setUsername,
  }
})
