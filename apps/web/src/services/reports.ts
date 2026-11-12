import type { MonthlyReport, MonthQuery } from '@oncall/shared'
import { apiGet } from '@/lib/http'
import { toQuery } from './query'

export async function monthly(query?: MonthQuery): Promise<MonthlyReport> {
  const { report } = await apiGet<{ report: MonthlyReport }>(`/reports/monthly${toQuery({ ...query })}`)
  return report
}
