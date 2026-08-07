import type { MonthlyReport, ReportHoliday } from '@oncall/shared'
import { query } from '../db/client'
import { daysInMonth, isoDate } from '../scheduling/dates'
import * as scheduleService from './schedule.service'
import * as statsService from './stats.service'

export async function monthlyReport(year: number, month: number): Promise<MonthlyReport> {
  // 1. Reuse Phase 7 aggregation: schedule (or null) + coverage + workload + fairness.
  const stats = await statsService.adminStats(year, month)

  // 2. Roster: only when a schedule exists. stats.schedule is non-null iff the row exists,
  //    so getById cannot throw 404 here.
  let roster: MonthlyReport['roster'] = []
  if (stats.schedule) {
    const detail = await scheduleService.getScheduleDuties(stats.schedule.id)
    roster = detail.duties
  }

  // 3. Holidays falling in this month (month bounds via the existing date helpers).
  const first = isoDate(year, month, 1)
  const last = isoDate(year, month, daysInMonth(year, month))
  const hres = await query<{ date: string; name: string }>(
    `SELECT date, name FROM holidays WHERE date >= $1 AND date <= $2 ORDER BY date`,
    [first, last],
  )
  const holidays: ReportHoliday[] = hres.rows.map((r) => ({ date: r.date, name: r.name }))

  return {
    year,
    month,
    generatedAt: new Date().toISOString(),
    schedule: stats.schedule,
    roster,
    coverage: stats.coverage,
    workload: stats.workload,
    fairness: stats.fairness,
    holidays,
  }
}
