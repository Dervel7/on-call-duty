export type ScheduleStatus = 'draft' | 'published'

/** On-call duty kind: 'open' days recur on a fixed cycle, all others are 'closed'. */
export type DutyType = 'open' | 'closed'

export interface ScheduleSummary {
  id: number
  year: number
  month: number
  status: ScheduleStatus
  clinicId: number
  clinicName: string
  createdBy: number | null
  createdAt: string
  updatedAt: string
}

export interface Duty {
  id: number
  scheduleId: number
  dutyDate: string
  doctorId: number
  doctorFirstName: string
  doctorLastName: string
  isWeekend: boolean
  reason: string
  createdAt: string
}

export interface AssignmentPlan {
  date: string
  doctorId: number
  doctorFirstName: string
  doctorLastName: string
  isWeekend: boolean
  reason: string
}

/** Doctors of the active pool kept off a short day, counted by the first rule that blocks each. */
export interface ConflictTally {
  unavailable: number
  atMonthlyCap: number
  atOpenDutyCap: number
  atHolidayCap: number
  backToBack: number
  alreadyOnDuty: number
}

/**
 * A day left below its minimum. Structured, not text, so the web app explains
 * it in the active UI language.
 */
export interface ConflictPlan {
  date: string
  /** Open on-call day or the day after it: the open on-call rule sets its minimum. */
  critical: boolean
  required: number
  assigned: number
  activeDoctors: number
  tally: ConflictTally
}

export interface DayInfo {
  date: string
  isWeekend: boolean
  /** Open on-call day (per the app_meta cycle) or a regular closed day. */
  dutyType: DutyType
  /** On-call doctors the day holds: open slots on open days, closed slots otherwise. */
  slotsRequired: number
  /** Hard minimum the day must hold: open minimum on open days, closed minimum otherwise. */
  slotsMinimum: number
  eligibleDoctorIds: number[]
  availableDoctorIds: number[]
}

export interface PreviewResult {
  assignments: AssignmentPlan[]
  conflicts: ConflictPlan[]
  days: DayInfo[]
}

/** One candidate schedule; not persisted. `days` is eligibility against this option. */
export interface ScheduleOption extends PreviewResult {
  /** 1-based position; 1 is the primary option. */
  index: number
  /** Dates whose doctor set differs from option 1 (empty for option 1). */
  changedDates: string[]
}

export interface ScheduleOptionsResult {
  year: number
  month: number
  options: ScheduleOption[]
}

export interface ScheduleDetail {
  schedule: ScheduleSummary
  duties: Duty[]
  days: DayInfo[]
}

export interface CreateScheduleRequest {
  year: number
  month: number
}

export interface GenerateAssignment {
  date: string
  doctorId: number
  reason?: string
}

export interface GenerateScheduleRequest {
  year: number
  month: number
  assignments?: GenerateAssignment[]
}

export interface ScheduleQuery {
  year?: number
  month?: number
  clinicId?: number
}

export interface CreateDutyRequest {
  date: string
  doctorId: number
}

export interface ReassignDutyRequest {
  doctorId: number
}
