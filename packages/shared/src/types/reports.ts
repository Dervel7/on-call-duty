import type { AdminCoverage, AdminFairness, AdminWorkloadItem } from './stats.ts'
import type { Duty, ScheduleSummary } from './schedule.ts'

export interface ReportQuery {
  year?: number
  month?: number
  clinicId?: number
}

export interface MonthlyReport {
  year: number
  month: number
  generatedAt: string
  /** Clinic of the schedule this report covers; null when no schedule exists for the month. */
  clinicName: string | null
  schedule: ScheduleSummary | null
  roster: Duty[]
  coverage: AdminCoverage
  workload: AdminWorkloadItem[]
  fairness: AdminFairness
}
