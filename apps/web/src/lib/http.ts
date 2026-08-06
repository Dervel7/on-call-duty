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

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`)
  const json = (await res.json()) as { success?: boolean; data?: T; error?: string }
  if (json?.success === true) return json.data as T
  throw new ApiError(json?.error ?? 'Request failed', res.status)
}
