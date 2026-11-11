import type { GenerateAssignment } from '@oncall/shared'
import { HttpError } from '../lib/http-error.ts'
import {
  assignmentViolation,
  minimumForDate,
  planHolidayViolation,
  slotsForDate,
  type SchedulingContext,
} from '../scheduling/index.ts'

export interface PlanDuty {
  date: string
  doctorId: number
  isWeekend: boolean
  reason: string
}

export function validatePlan(ctx: SchedulingContext, assignments: GenerateAssignment[]): PlanDuty[] {
  const activeIds = new Set(ctx.doctors.map((d) => d.id))
  const dayInfo = new Map(ctx.days.map((d) => [d.date, d]))

  const byDate = new Map<string, GenerateAssignment[]>()
  for (const a of assignments) {
    if (!dayInfo.has(a.date))
      throw new HttpError(400, `Assignment date ${a.date} is outside the schedule month`)
    if (!activeIds.has(a.doctorId))
      throw new HttpError(400, `Doctor ${a.doctorId} is not an active doctor`)
    byDate.set(a.date, [...(byDate.get(a.date) ?? []), a])
  }

  // The same hard rules as manual edits, so a plan cannot persist a schedule
  // the administrator could not build by hand. Each duty is judged against
  // all the others, so the order of the plan does not matter.
  for (const [i, a] of assignments.entries()) {
    const others = assignments.filter((_, j) => j !== i)
    const violation = assignmentViolation(ctx, others, a, { checkHolidayCap: false })
    if (violation) throw new HttpError(409, `Constraint violation: ${violation}`)
  }

  for (const [date, arr] of byDate) {
    const max = slotsForDate(date, ctx.openDuty, ctx.slots)
    if (arr.length > max)
      throw new HttpError(
        409,
        `Too many assignments (${arr.length}) for ${date}; max ${max}`,
      )
  }

  const empty = ctx.days.map((d) => d.date).filter((date) => !byDate.has(date))
  if (empty.length > 0)
    throw new HttpError(
      422,
      `${empty.length} day(s) have no doctor: ${empty.join(', ')}; assign at least one per day`,
    )

  // Strict rule: every day holds at least its minimum (open minimum on open
  // on-call days, closed minimum on all others, including the day after an
  // open day).
  const short = ctx.days
    .map((d) => d.date)
    .filter(
      (date) =>
        (byDate.get(date)?.length ?? 0) < minimumForDate(date, ctx.openDuty, ctx.minimums),
    )
  if (short.length > 0)
    throw new HttpError(
      422,
      `${short.length} day(s) are below their minimum on-call doctors: ${short.join(', ')}; every day needs at least its minimum`,
    )

  const holidayViolation = planHolidayViolation(ctx, assignments)
  if (holidayViolation) throw new HttpError(409, `Constraint violation: ${holidayViolation}`)

  return assignments.map((a) => ({
    date: a.date,
    doctorId: a.doctorId,
    isWeekend: dayInfo.get(a.date)!.isWeekend,
    reason: a.reason ?? 'plan',
  }))
}
