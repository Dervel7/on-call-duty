import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { router } from '../router'

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.unstubAllGlobals())

describe('router', () => {
  it('redirects unknown URLs to home', () => {
    const matched = router.resolve('/does-not-exist').matched
    expect(matched).toHaveLength(1)
    expect(matched[0]?.redirect).toEqual({ name: 'home' })
  })

  it('reloads on the target URL when a lazy chunk is gone after a deploy', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { assign })
    router.addRoute({
      path: '/stale-chunk',
      meta: { public: true },
      component: () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
    })
    await router.push('/stale-chunk').catch(() => {})
    expect(assign).toHaveBeenCalledWith('/stale-chunk')
  })
})
