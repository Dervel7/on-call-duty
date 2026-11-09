/** Builds a `?a=1&b=2` query string, skipping undefined and empty values; empty when nothing is set. */
export function toQuery(params: Record<string, string | number | undefined> = {}): string {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') qs.set(key, String(value))
  }
  const s = qs.toString()
  return s ? `?${s}` : ''
}
