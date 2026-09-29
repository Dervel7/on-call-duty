import type { Holiday, HolidayQuery } from '@oncall/shared'
import { apiGet, apiPut } from '@/lib/http'

function toQuery(query: HolidayQuery): string {
  const parts: string[] = [`year=${query.year}`]
  if (query.clinicId !== undefined) parts.push(`clinicId=${query.clinicId}`)
  return `?${parts.join('&')}`
}

export async function listHolidays(year: number, clinicId?: number): Promise<Holiday[]> {
  const { holidays } = await apiGet<{ holidays: Holiday[] }>(`/holidays${toQuery({ year, clinicId })}`)
  return holidays
}

export async function setMonthHolidays(
  year: number,
  month: number,
  dates: string[],
): Promise<Holiday[]> {
  const { holidays } = await apiPut<{ holidays: Holiday[] }>('/holidays/month', {
    year,
    month,
    dates,
  })
  return holidays
}
