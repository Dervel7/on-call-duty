import type { AdminStats, MeStats, StatsQuery } from '@oncall/shared'
import { apiGet } from '@/lib/http'

function toQuery(query?: StatsQuery): string {
  if (!query) return ''
  const parts: string[] = []
  if (query.year !== undefined) parts.push(`year=${query.year}`)
  if (query.month !== undefined) parts.push(`month=${query.month}`)
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}

export async function admin(query?: StatsQuery): Promise<AdminStats> {
  const { stats } = await apiGet<{ stats: AdminStats }>(`/stats/admin${toQuery(query)}`)
  return stats
}

export async function me(): Promise<MeStats> {
  const { stats } = await apiGet<{ stats: MeStats }>(`/stats/me`)
  return stats
}
