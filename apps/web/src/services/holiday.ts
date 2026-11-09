import type { Holiday } from '@oncall/shared'
import { apiGet, apiPut } from '@/lib/http'
import { toQuery } from './query'

export async function listHolidays(year: number): Promise<Holiday[]> {
  const { holidays } = await apiGet<{ holidays: Holiday[] }>(`/holidays${toQuery({ year })}`)
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
