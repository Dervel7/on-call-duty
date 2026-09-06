import type { AdminCoverage, AdminFairness, AdminWorkloadItem } from './stats'
import type { Duty, ScheduleSummary } from './schedule'

export interface ReportQuery {
  year?: number
  month?: number
}

export interface MonthlyReport {
  year: number
  month: number
  generatedAt: string
  schedule: ScheduleSummary | null
  roster: Duty[]
  coverage: AdminCoverage
  workload: AdminWorkloadItem[]
  fairness: AdminFairness
}
