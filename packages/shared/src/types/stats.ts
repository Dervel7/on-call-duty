import type { ScheduleSummary } from './schedule'

export interface StatsQuery {
  year?: number
  month?: number
}

// ---- Admin dashboard ----

export interface AdminWorkloadItem {
  doctorId: number
  firstName: string
  lastName: string
  isActive: boolean
  maxMonthly: number
  duties: number
  weekday: number
  weekend: number
}

export interface AdminCoverage {
  daysInMonth: number
  filled: number
  gaps: string[]
}

export interface AdminFairness {
  dutySpread: number | null
  weekendSpread: number | null
}

export interface AdminStats {
  year: number
  month: number
  schedule: ScheduleSummary | null
  coverage: AdminCoverage
  workload: AdminWorkloadItem[]
  fairness: AdminFairness
}

// ---- Doctor dashboard ----

export interface MeCurrentMonth {
  year: number
  month: number
  published: boolean
  duties: number
  weekend: number
  maxMonthly: number
}

export interface MeUpcomingDuty {
  dutyDate: string
  isWeekend: boolean
}

export interface OnCallEntry {
  date: string
  doctorFirstName: string
  doctorLastName: string
  isWeekend: boolean
  isMine: boolean
}

export interface MeStats {
  doctor: { id: number; firstName: string; lastName: string; maxMonthlyDuties: number }
  currentMonth: MeCurrentMonth
  upcoming: MeUpcomingDuty[]
  onCall: OnCallEntry[]
}
