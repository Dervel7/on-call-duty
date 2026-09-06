export type ScheduleStatus = 'draft' | 'published'

export interface ScheduleSummary {
  id: number
  year: number
  month: number
  status: ScheduleStatus
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

export interface ConflictPlan {
  date: string
  detail: string
}

export interface DayInfo {
  date: string
  isWeekend: boolean
  eligibleDoctorIds: number[]
  availableDoctorIds: number[]
}

export interface PreviewResult {
  assignments: AssignmentPlan[]
  conflicts: ConflictPlan[]
  days: DayInfo[]
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
}

export interface CreateDutyRequest {
  date: string
  doctorId: number
}

export interface ReassignDutyRequest {
  doctorId: number
}
