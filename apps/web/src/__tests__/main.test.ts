import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

const { routerInstall, refreshMock, resolveRefresh } = vi.hoisted(() => {
  let settle: ((value: string | null) => void) | undefined
  const refreshMock = vi.fn(
    () =>
      new Promise<string | null>((resolve) => {
        settle = resolve
      }),
  )
  return {
    routerInstall: vi.fn(),
    refreshMock,
    resolveRefresh: (value: string | null) => settle?.(value),
  }
})

vi.mock('../router', () => ({
  router: { install: routerInstall },
}))

vi.mock('../stores/auth', () => ({
  useAuthStore: () => ({ refresh: refreshMock }),
}))

vi.mock('../App.vue', () => ({
  default: { render: () => null },
}))

vi.mock('../style.css', () => ({}))

afterEach(() => vi.restoreAllMocks())

describe('main bootstrap', () => {
  it('installs the router only after the auth refresh attempt has settled', async () => {
    const appEl = document.createElement('div')
    appEl.id = 'app'
    document.body.appendChild(appEl)

    const mainLoaded = import('../main')
    await vi.waitFor(
      () => {
        expect(refreshMock).toHaveBeenCalledTimes(1)
      },
      { timeout: 5000 },
    )
    expect(routerInstall).not.toHaveBeenCalled()

    resolveRefresh(null)
    await mainLoaded
    await flushPromises()

    expect(routerInstall).toHaveBeenCalledTimes(1)
  })
})
