import { afterEach, describe, expect, it, vi } from 'vitest'

const apiPost = vi.fn()
vi.mock('@/lib/http', () => ({ apiGet: vi.fn(), apiPost: (...a: unknown[]) => apiPost(...a) }))

import { refresh } from '../services/auth'

afterEach(() => {
  vi.unstubAllGlobals()
  apiPost.mockReset()
})

describe('auth service refresh', () => {
  it('posts inside the cross-tab refresh lock when Web Locks are available', async () => {
    const order: string[] = []
    const request = vi.fn(async (_name: string, cb: () => Promise<unknown>) => {
      order.push('lock')
      return cb()
    })
    apiPost.mockImplementation(async () => {
      order.push('post')
      return { accessToken: 'T' }
    })
    vi.stubGlobal('navigator', { locks: { request } })
    await expect(refresh()).resolves.toEqual({ accessToken: 'T' })
    expect(request.mock.calls[0]?.[0]).toBe('oncall-auth-refresh')
    expect(order).toEqual(['lock', 'post'])
  })

  it('still posts when Web Locks are unavailable', async () => {
    apiPost.mockResolvedValue({ accessToken: 'T' })
    vi.stubGlobal('navigator', {})
    await expect(refresh()).resolves.toEqual({ accessToken: 'T' })
    expect(apiPost).toHaveBeenCalledWith('/auth/refresh')
  })
})
