import type { AdminStats, MeStats, StatsQuery } from '@oncall/shared'
import { apiGet } from '@/lib/http'
import { toQuery } from './query'

export async function admin(query?: StatsQuery): Promise<AdminStats> {
  const { stats } = await apiGet<{ stats: AdminStats }>(`/stats/admin${toQuery(query)}`)
  return stats
}

export async function me(): Promise<MeStats> {
  const { stats } = await apiGet<{ stats: MeStats }>(`/stats/me`)
  return stats
}
