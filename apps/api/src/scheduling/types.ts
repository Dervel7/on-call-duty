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
}

export interface SchedulingContext {
  year: number
  month: number
  days: DaySpec[]
  doctors: DoctorSpec[]
  unavailability: Map<number, Array<{ start: string; end: string }>>
  priorDayDoctorIds: Set<number>
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
