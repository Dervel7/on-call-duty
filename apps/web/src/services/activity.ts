import type { ActivityQuery, PaginatedActivity } from '@oncall/shared'
import { apiGet } from '@/lib/http'

export async function getActivity(query: ActivityQuery = {}): Promise<PaginatedActivity> {
  const params = new URLSearchParams()
  if (query.action) params.set('action', query.action)
  if (query.userId) params.set('userId', String(query.userId))
  if (query.from) params.set('from', query.from)
  if (query.to) params.set('to', query.to)
  if (query.page) params.set('page', String(query.page))
  if (query.limit) params.set('limit', String(query.limit))
  const qs = params.toString()
  const { activity } = await apiGet<{ activity: PaginatedActivity }>(
    `/activity${qs ? `?${qs}` : ''}`,
  )
  return activity
}
