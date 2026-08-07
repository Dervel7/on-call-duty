import type { CreateHolidayRequest, Holiday, UpdateHolidayRequest } from '@oncall/shared'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/http'

export async function list(): Promise<Holiday[]> {
  const { holidays } = await apiGet<{ holidays: Holiday[] }>('/holidays')
  return holidays
}
export async function create(input: CreateHolidayRequest): Promise<Holiday> {
  const { holiday } = await apiPost<{ holiday: Holiday }>('/holidays', input)
  return holiday
}
export async function update(id: number, input: UpdateHolidayRequest): Promise<Holiday> {
  const { holiday } = await apiPatch<{ holiday: Holiday }>(`/holidays/${id}`, input)
  return holiday
}
export async function remove(id: number): Promise<void> {
  await apiDelete<void>(`/holidays/${id}`)
}
