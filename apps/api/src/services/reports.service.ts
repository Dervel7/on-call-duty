import type { MonthlyReport } from '@oncall/shared'
import * as scheduleService from './schedule.service'
import * as statsService from './stats.service'

export async function monthlyReport(year: number, month: number): Promise<MonthlyReport> {
  // 1. Reuse the Phase 7 aggregation: schedule (or null) + coverage + workload + fairness.
  const stats = await statsService.adminStats(year, month)

  // 2. Roster: only when a schedule exists. stats.schedule is non-null iff the row exists,
  //    so getById cannot throw 404 here.
  let roster: MonthlyReport['roster'] = []
  if (stats.schedule) {
    const detail = await scheduleService.getScheduleDuties(stats.schedule.id)
    roster = detail.duties
  }

  return {
    year,
    month,
    generatedAt: new Date().toISOString(),
    schedule: stats.schedule,
    roster,
    coverage: stats.coverage,
    workload: stats.workload,
    fairness: stats.fairness,
  }
}
