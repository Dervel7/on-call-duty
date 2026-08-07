import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPost,
  setAccessToken,
  setRefreshHandler,
} from '../lib/http'

function envelope(data: unknown, ok = true) {
  return { success: ok, data }
}

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  setAccessToken(null)
  setRefreshHandler(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('http client', () => {
  it('sends Authorization header when a token is set', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonRes(envelope({ ok: 1 }), 200),
    )
    vi.stubGlobal('fetch', fetchMock)
    setAccessToken('AAA')
    await apiGet('/x')
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer AAA')
    expect(init.credentials).toBe('include')
  })

  it('does not retry on /auth/refresh 401 (no recursion)', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonRes(envelope(undefined, false), 401),
    )
    vi.stubGlobal('fetch', fetchMock)
    setRefreshHandler(async () => 'NEW')
    await expect(apiPost('/auth/refresh')).rejects.toBeInstanceOf(ApiError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('on a 401 for a normal path, calls refresh handler once and retries', async () => {
    let calls = 0
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
      calls++
      if (calls === 1) return jsonRes(envelope(undefined, false), 401)
      return jsonRes(envelope({ ok: 2 }), 200)
    })
    vi.stubGlobal('fetch', fetchMock)
    const refresh = vi.fn(async () => 'NEW')
    setRefreshHandler(refresh)
    const data = await apiGet('/users')
    expect(data).toEqual({ ok: 2 })
    expect(refresh).toHaveBeenCalledTimes(1)
    const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect((secondInit.headers as Record<string, string>).Authorization).toBe('Bearer NEW')
  })

  it('treats a 204 No Content response as a successful delete', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(null, { status: 204 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiDelete<void>('/x')).resolves.toBeUndefined()
  })
})
