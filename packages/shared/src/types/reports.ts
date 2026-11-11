import type { AdminCoverage, AdminFairness, AdminWorkloadItem } from './stats.ts'
import type { Duty, ScheduleSummary } from './schedule.ts'

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
