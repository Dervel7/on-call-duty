import type {
  AdminCoverage,
  AdminFairness,
  AdminStats,
  AdminWorkloadItem,
  MeStats,
  OnCallEntry,
  ScheduleStatus,
  ScheduleSummary,
} from '@oncall/shared'
import { query } from '../db/client'
import { daysInMonth, isoDate } from '../scheduling/dates'
import { getByUserId as getDoctorByUserId } from './doctor.service'

interface ScheduleRow {
  id: number
  year: number
  month: number
  status: string
  created_by: number | null
  created_at: Date
  updated_at: Date
}

function toSchedule(row: ScheduleRow): ScheduleSummary {
  return {
    id: row.id,
    year: row.year,
    month: row.month,
    status: row.status as ScheduleStatus,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function plusDaysISO(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function currentYearMonth(): { year: number; month: number } {
  const now = new Date()
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }
}

function spread(values: number[]): number | null {
  if (values.length < 2) return null
  return Math.max(...values) - Math.min(...values)
}

export async function adminStats(year: number, month: number): Promise<AdminStats> {
  const sres = await query<ScheduleRow>(
    `SELECT id, year, month, status, created_by, created_at, updated_at
     FROM schedules WHERE year = $1 AND month = $2`,
    [year, month],
  )
  const scheduleRow = sres.rows[0] ?? null
  const schedule: ScheduleSummary | null = scheduleRow ? toSchedule(scheduleRow) : null

  const total = daysInMonth(year, month)
  const allDays: string[] = []
  for (let d = 1; d <= total; d++) allDays.push(isoDate(year, month, d))

  const perDate = new Map<string, number>()
  if (scheduleRow) {
    const dres = await query<{ duty_date: string; n: number }>(
      `SELECT duty_date, COUNT(*)::int AS n FROM duties WHERE schedule_id = $1 GROUP BY duty_date`,
      [scheduleRow.id],
    )
    for (const r of dres.rows) perDate.set(r.duty_date, r.n)
  }
  const coverage: AdminCoverage = {
    daysInMonth: total,
    filled: allDays.filter((d) => (perDate.get(d) ?? 0) >= 2).length,
    gaps: allDays.filter((d) => (perDate.get(d) ?? 0) < 2),
  }

  const activeRes = await query<{
    id: number
    first_name: string
    last_name: string
    max_monthly_duties: number
  }>(
    `SELECT d.id, u.first_name, u.last_name, d.max_monthly_duties
     FROM doctors d JOIN users u ON u.id = d.user_id
     WHERE u.is_active = TRUE`,
  )
  const counts = new Map<number, { total: number; weekend: number }>()
  if (scheduleRow) {
    const cRes = await query<{
      doctor_id: number
      total: number
      weekend: number
    }>(
      `SELECT doctor_id,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE is_weekend)::int AS weekend
       FROM duties WHERE schedule_id = $1 GROUP BY doctor_id`,
      [scheduleRow.id],
    )
    for (const r of cRes.rows)
      counts.set(r.doctor_id, { total: r.total, weekend: r.weekend })
  }

  const byId = new Map<number, AdminWorkloadItem>()
  for (const a of activeRes.rows) {
    byId.set(a.id, {
      doctorId: a.id,
      firstName: a.first_name,
      lastName: a.last_name,
      isActive: true,
      maxMonthly: a.max_monthly_duties,
      duties: 0,
      weekday: 0,
      weekend: 0,
    })
  }
  if (scheduleRow) {
    const inactiveRes = await query<{
      id: number
      first_name: string
      last_name: string
      max_monthly_duties: number
    }>(
      `SELECT DISTINCT d.id, u.first_name, u.last_name, d.max_monthly_duties
       FROM doctors d JOIN users u ON u.id = d.user_id
       JOIN duties du ON du.doctor_id = d.id
       WHERE u.is_active = FALSE AND du.schedule_id = $1`,
      [scheduleRow.id],
    )
    for (const r of inactiveRes.rows) {
      if (!byId.has(r.id))
        byId.set(r.id, {
          doctorId: r.id,
          firstName: r.first_name,
          lastName: r.last_name,
          isActive: false,
          maxMonthly: r.max_monthly_duties,
          duties: 0,
          weekday: 0,
          weekend: 0,
        })
    }
  }

  const workload: AdminWorkloadItem[] = []
  for (const item of byId.values()) {
    const c = counts.get(item.doctorId)
    if (c) {
      item.duties = c.total
      item.weekend = c.weekend
      item.weekday = c.total - c.weekend
    }
    workload.push(item)
  }
  workload.sort((a, b) =>
    a.lastName === b.lastName
      ? a.firstName.localeCompare(b.firstName)
      : a.lastName.localeCompare(b.lastName),
  )

  const assignedDoctors = workload.filter((w) => w.duties > 0)
  const fairness: AdminFairness = {
    dutySpread: spread(assignedDoctors.map((w) => w.duties)),
    weekendSpread: spread(assignedDoctors.map((w) => w.weekend)),
  }

  return { year, month, schedule, coverage, workload, fairness }
}

export async function meStats(userId: number): Promise<MeStats> {
  const doctor = await getDoctorByUserId(userId)
  const { year, month } = currentYearMonth()

  const pubRes = await query(
    `SELECT 1 FROM schedules WHERE status = 'published' AND year = $1 AND month = $2`,
    [year, month],
  )
  const published = pubRes.rows.length > 0

  const countsRes = await query<{ total: number; weekend: number }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE du.is_weekend)::int AS weekend
     FROM duties du JOIN schedules s ON s.id = du.schedule_id
     WHERE s.status = 'published' AND s.year = $1 AND s.month = $2 AND du.doctor_id = $3`,
    [year, month, doctor.id],
  )
  const c = countsRes.rows[0] ?? { total: 0, weekend: 0 }

  const upcomingRes = await query<{ duty_date: string; is_weekend: boolean }>(
    `SELECT du.duty_date, du.is_weekend
     FROM duties du JOIN schedules s ON s.id = du.schedule_id
     WHERE s.status = 'published' AND du.doctor_id = $1 AND du.duty_date >= $2
     ORDER BY du.duty_date LIMIT 10`,
    [doctor.id, todayISO()],
  )

  const start = todayISO()
  const end = plusDaysISO(start, 7)
  const onCallRes = await query<{
    duty_date: string
    is_weekend: boolean
    first_name: string
    last_name: string
    doctor_id: number
  }>(
    `SELECT du.duty_date, du.is_weekend, u.first_name, u.last_name, du.doctor_id
     FROM duties du JOIN schedules s ON s.id = du.schedule_id
     JOIN doctors d ON d.id = du.doctor_id JOIN users u ON u.id = d.user_id
     WHERE s.status = 'published' AND du.duty_date BETWEEN $1 AND $2
     ORDER BY du.duty_date`,
    [start, end],
  )
  const onCall: OnCallEntry[] = onCallRes.rows.map((r) => ({
    date: r.duty_date,
    doctorFirstName: r.first_name,
    doctorLastName: r.last_name,
    isWeekend: r.is_weekend,
    isMine: r.doctor_id === doctor.id,
  }))

  return {
    doctor: {
      id: doctor.id,
      firstName: doctor.firstName,
      lastName: doctor.lastName,
      maxMonthlyDuties: doctor.maxMonthlyDuties,
    },
    currentMonth: {
      year,
      month,
      published,
      duties: c.total,
      weekend: c.weekend,
      maxMonthly: doctor.maxMonthlyDuties,
    },
    upcoming: upcomingRes.rows.map((r) => ({
      dutyDate: r.duty_date,
      isWeekend: r.is_weekend,
    })),
    onCall,
  }
}

// Re-exported so the controller can build the default year/month without duplicating logic.
export { currentYearMonth as currentYearMonthUTC }
