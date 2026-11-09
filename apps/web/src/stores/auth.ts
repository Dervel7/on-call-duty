import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AuthUser, Language, LoginResponse } from '@oncall/shared'
import { setAccessToken, setLockedHandler, setRefreshHandler } from '@/lib/http'
import * as authService from '@/services/auth'
import * as userService from '@/services/user'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const accessToken = ref<string | null>(null)
  const locked = ref(false)

  const isAuthenticated = computed(() => accessToken.value !== null)
  const isAdmin = computed(
    () => user.value?.role === 'administrator' || user.value?.role === 'superadmin',
  )
  const isSuperadmin = computed(() => user.value?.role === 'superadmin')

  async function login(identifier: string, password: string): Promise<void> {
    setSession(await authService.login(identifier, password))
    locked.value = false
  }

  /** The store is the only owner of the token the http module sends, so the two never drift. */
  function setSession(data: LoginResponse): void {
    user.value = data.user
    accessToken.value = data.accessToken
    setAccessToken(data.accessToken)
  }

  function clearSession(): void {
    user.value = null
    accessToken.value = null
    setAccessToken(null)
  }

  async function refresh(): Promise<string | null> {
    try {
      const data = await authService.refresh()
      setSession(data)
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
      // Best effort: the cookie is cleared server side when reachable.
    }
    clearSession()
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

  async function setLanguage(language: Language): Promise<void> {
    const updated = await userService.updateLanguage(language)
    // Keep the stored AuthUser shape; only the preference changes.
    if (user.value) user.value = { ...user.value, language: updated.language }
  }

  async function setUsername(username: string): Promise<void> {
    const updated = await userService.updateUsername(username)
    // Keep the stored AuthUser shape; only the username changes.
    if (user.value) user.value = { ...user.value, username: updated.username }
  }

  // A refresh that fails mid-request means the session is gone: send the user to sign in.
  // The bootstrap refresh in main.ts calls refresh() directly and must not redirect.
  // A lock detected during the refresh is routed by the guard (`locked`), not here.
  setRefreshHandler(async () => {
    const token = await refresh()
    if (token === null && !locked.value) {
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
    locked.value = true
    import('@/router')
      .then(({ router }) => router.push({ name: 'locked' }))
      .catch(() => {})
  })

  return {
    user,
    accessToken,
    locked,
    isAuthenticated,
    isAdmin,
    isSuperadmin,
    login,
    refresh,
    logout,
    fetchMe,
    changePassword,
    setDarkMode,
    setLanguage,
    setUsername,
  }
})
