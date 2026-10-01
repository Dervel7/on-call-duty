import type { DutyMinimumSettings, DutySlotsSettings, OpenDutySettings } from '@oncall/shared'

export interface DoctorSpec {
  id: number
  firstName: string
  lastName: string
  maxMonthlyDuties: number
  isActive: boolean
}

export interface DaySpec {
  date: string
  dayOfWeek: number // 0=Sun … 6=Sat
  isWeekend: boolean
  /** Weekend or admin-marked holiday for the clinic; holiday-duty cap applies. */
  isHoliday: boolean
}

export interface SchedulingContext {
   year: number
   month: number
   days: DaySpec[]
   doctors: DoctorSpec[]
   unavailability: Map<number, Array<{ start: string; end: string }>>
   priorDayDoctorIds: Set<number>
  /** Open on-call cycle; open days and the day after them are critical. */
  openDuty: OpenDutySettings
  /** Per-day on-call capacity: open, post-open (day after open), or closed slots. */
  slots: DutySlotsSettings
  /** Hard per-day minimum, chosen by the same day type as `slots`. */
  minimums: DutyMinimumSettings
}

export interface CandidateScore {
  score: number
  workload: number
  weekend: number
  friday: number
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

export interface GenerateResult {
  assignments: AssignmentPlan[]
  conflicts: ConflictPlan[]
}
