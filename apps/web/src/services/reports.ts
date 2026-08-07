import type { MonthlyReport, ReportQuery } from '@oncall/shared'
import { apiGet } from '@/lib/http'

function toQuery(query?: ReportQuery): string {
  if (!query) return ''
  const parts: string[] = []
  if (query.year !== undefined) parts.push(`year=${query.year}`)
  if (query.month !== undefined) parts.push(`month=${query.month}`)
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}

export async function monthly(query?: ReportQuery): Promise<MonthlyReport> {
  const { report } = await apiGet<{ report: MonthlyReport }>(`/reports/monthly${toQuery(query)}`)
  return report
}
