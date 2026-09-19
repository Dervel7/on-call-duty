import type { AuthUser, MonthlyReport } from '@oncall/shared'
import type { ClinicScope } from '../lib/scope'
import * as scheduleService from './schedule.service'
import * as statsService from './stats.service'

type Actor = Pick<AuthUser, 'id' | 'role' | 'clinicId'>

export async function monthlyReport(
  year: number,
  month: number,
  actor: Actor,
  scope: ClinicScope,
): Promise<MonthlyReport> {
  // 1. Reuse the Phase 7 aggregation: schedule (or null) + coverage + workload + fairness.
  const stats = await statsService.adminStats(year, month, scope)

  // 2. Roster: only when a schedule exists. stats.schedule is non-null iff the row exists,
  //    so getById cannot throw 404 here. The actor is forwarded so the object-level
  //    clinic check (cross-clinic 404) applies to the roster read too.
  let roster: MonthlyReport['roster'] = []
  if (stats.schedule) {
    const detail = await scheduleService.getScheduleDuties(stats.schedule.id, actor)
    roster = detail.duties
  }

  return {
    year,
    month,
    generatedAt: new Date().toISOString(),
    clinicName: stats.schedule?.clinicName ?? null,
    schedule: stats.schedule,
    roster,
    coverage: stats.coverage,
    workload: stats.workload,
    fairness: stats.fairness,
  }
}
