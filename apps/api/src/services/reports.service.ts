import type { MonthlyReport } from '@oncall/shared'
import type { ClinicScope } from '../lib/scope.ts'
import { listDutiesBySchedule } from './schedule.service.ts'
import * as statsService from './stats.service.ts'

export async function monthlyReport(
  scope: ClinicScope,
  year?: number,
  month?: number,
): Promise<MonthlyReport> {
  // adminStats selects the schedule by the caller's clinic scope, so the roster needs no second check.
  const stats = await statsService.adminStats(scope, year, month)
  const roster = stats.schedule ? await listDutiesBySchedule(stats.schedule.id) : []

  return {
    year: stats.year,
    month: stats.month,
    generatedAt: new Date().toISOString(),
    schedule: stats.schedule,
    roster,
    coverage: stats.coverage,
    workload: stats.workload,
    fairness: stats.fairness,
  }
}
