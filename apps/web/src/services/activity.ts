import type { ActivityQuery, PaginatedActivity } from '@oncall/shared'
import { apiGet } from '@/lib/http'
import { toQuery } from './query'

export async function getActivity(query: ActivityQuery = {}): Promise<PaginatedActivity> {
  const { activity } = await apiGet<{ activity: PaginatedActivity }>(
    `/activity${toQuery({ ...query })}`,
  )
  return activity
}
