import type {
  CreateDutyRequest,
  Duty,
  PreviewResult,
  ReassignDutyRequest,
  ScheduleDetail,
  ScheduleQuery,
  ScheduleSummary,
} from '@oncall/shared'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/http'

function toQuery(query?: ScheduleQuery): string {
  if (!query) return ''
  const parts: string[] = []
  if (query.year !== undefined) parts.push(`year=${query.year}`)
  if (query.month !== undefined) parts.push(`month=${query.month}`)
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}

export async function list(query?: ScheduleQuery): Promise<ScheduleSummary[]> {
  const { schedules } = await apiGet<{ schedules: ScheduleSummary[] }>(`/schedules${toQuery(query)}`)
  return schedules
}
export async function get(id: number): Promise<ScheduleDetail> {
  return apiGet<ScheduleDetail>(`/schedules/${id}`)
}
export async function preview(year: number, month: number): Promise<PreviewResult> {
  return apiPost<PreviewResult>('/schedules/preview', { year, month })
}
export async function generate(year: number, month: number): Promise<ScheduleDetail> {
  return apiPost<ScheduleDetail>('/schedules', { year, month })
}
export async function remove(id: number): Promise<void> {
  await apiDelete<void>(`/schedules/${id}`)
}
export async function publish(id: number): Promise<ScheduleSummary> {
  const { schedule } = await apiPost<{ schedule: ScheduleSummary }>(`/schedules/${id}/publish`)
  return schedule
}
export async function unpublish(id: number): Promise<ScheduleSummary> {
  const { schedule } = await apiPost<{ schedule: ScheduleSummary }>(`/schedules/${id}/unpublish`)
  return schedule
}
export async function addDuty(scheduleId: number, input: CreateDutyRequest): Promise<Duty> {
  const { duty } = await apiPost<{ duty: Duty }>(`/schedules/${scheduleId}/duties`, input)
  return duty
}
export async function reassignDuty(dutyId: number, input: ReassignDutyRequest): Promise<Duty> {
  const { duty } = await apiPatch<{ duty: Duty }>(`/duties/${dutyId}`, input)
  return duty
}
export async function removeDuty(dutyId: number): Promise<void> {
  await apiDelete<void>(`/duties/${dutyId}`)
}
