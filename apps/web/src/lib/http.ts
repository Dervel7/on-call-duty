const BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let accessToken: string | null = null
export function setAccessToken(token: string | null): void {
  accessToken = token
}

type RefreshHandler = () => Promise<string | null>
let refreshHandler: RefreshHandler | null = null
export function setRefreshHandler(fn: RefreshHandler | null): void {
  refreshHandler = fn
}

interface Envelope {
  success?: boolean
  data?: unknown
  error?: string
}

async function parseEnvelope(res: Response): Promise<Envelope> {
  const text = await res.text()
  if (!text) return {}
  try {
    return JSON.parse(text) as Envelope
  } catch {
    return {}
  }
}

function isRefreshPath(path: string): boolean {
  return path.startsWith('/auth/refresh')
}

let refreshing: Promise<string | null> | null = null

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const send = (token: string | null): Promise<Response> =>
    fetch(`${BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

  let res = await send(accessToken)

  if (res.status === 401 && !isRefreshPath(path) && refreshHandler) {
    const next = await (refreshing ??= refreshHandler().finally(() => (refreshing = null)))
    if (next) res = await send(next)
  }

  const json = await parseEnvelope(res)
  if (res.ok && json.success === true) return json.data as T
  throw new ApiError(json.error ?? 'Request failed', res.status)
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>('GET', path)
}
export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, body)
}
export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PATCH', path, body)
}
export function apiDelete<T>(path: string): Promise<T> {
  return request<T>('DELETE', path)
}
