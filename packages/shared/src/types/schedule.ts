export type ScheduleStatus = 'draft' | 'published'

export interface Holiday {
  id: number
  name: string
  date: string
  createdAt: string
  updatedAt: string
}

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
  isHoliday: boolean
  reason: string
  createdAt: string
}

export interface AssignmentPlan {
  date: string
  doctorId: number
  doctorFirstName: string
  doctorLastName: string
  isWeekend: boolean
  isHoliday: boolean
  reason: string
}

export interface ConflictPlan {
  date: string
  detail: string
}

export interface PreviewResult {
  assignments: AssignmentPlan[]
  conflicts: ConflictPlan[]
}

export interface ScheduleDetail {
  schedule: ScheduleSummary
  duties: Duty[]
}

export interface CreateScheduleRequest {
  year: number
  month: number
}

export interface ScheduleQuery {
  year?: number
  month?: number
}

export interface HolidayQuery {
  from?: string
  to?: string
}

export interface CreateHolidayRequest {
  name: string
  date: string
}

export interface UpdateHolidayRequest {
  name?: string
  date?: string
}

export interface CreateDutyRequest {
  date: string
  doctorId: number
}

export interface ReassignDutyRequest {
  doctorId: number
}
