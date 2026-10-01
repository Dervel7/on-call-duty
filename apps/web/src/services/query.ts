/** Builds a `?year=..&month=..` query string; empty when no field is set. */
export function toQuery(query?: { year?: number; month?: number }): string {
  if (!query) return ''
  const parts: string[] = []
  if (query.year !== undefined) parts.push(`year=${query.year}`)
  if (query.month !== undefined) parts.push(`month=${query.month}`)
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}
