import { isOpenDutyDate, minimumForDate, requiresDoubleCoverage, slotsForDate } from './dates'
import { blockingRule, emptyTally } from './conflicts'
import { scoreCandidate, weekendBudget, fridayBudget } from './scoring'
import type {
  AssignmentPlan,
  CandidateScore,
  ConflictPlan,
  ConflictTally,
  DaySpec,
  DoctorSpec,
  GenerateResult,
  SchedulingContext,
} from './types'

interface Eligible {
  doctor: DoctorSpec
  score: CandidateScore
}

interface RunState {
  total: Map<number, number>
  weekend: Map<number, number>
  friday: Map<number, number>
  /** Duties per doctor per day of week (index 0=Sun … 6=Sat). */
  weekday: Map<number, number[]>
  holiday: Map<number, number>
  openDays: Map<number, number>
  byDate: Map<string, Set<number>>
}

/**
 * Greedy engine: fills one slot at a time in a fixed pass order and never
 * revisits a choice. Kept as the fallback when the exact solver fails.
 */
export function generateGreedy(ctx: SchedulingContext): GenerateResult {
  const assignments: AssignmentPlan[] = []
  const conflicts: ConflictPlan[] = []

  const state: RunState = {
    total: new Map(),
    weekend: new Map(),
    friday: new Map(),
    weekday: new Map(),
    holiday: new Map(),
    openDays: new Map(),
    byDate: new Map(),
  }
  for (const d of ctx.doctors) {
    state.total.set(d.id, 0)
    state.weekend.set(d.id, 0)
    state.friday.set(d.id, 0)
    state.weekday.set(d.id, [0, 0, 0, 0, 0, 0, 0])
    state.holiday.set(d.id, 0)
    state.openDays.set(d.id, 0)
  }

  const activeCount = ctx.doctors.length
  const weekendSlots = ctx.days.reduce(
    (sum, d) => sum + (d.isWeekend ? slotsForDate(d.date, ctx.openDuty, ctx.slots) : 0),
    0,
  )
  const fridaySlots = ctx.days
    .filter((d) => d.dayOfWeek === 5)
    .reduce((sum, d) => sum + slotsForDate(d.date, ctx.openDuty, ctx.slots), 0)
  const wBudget = weekendBudget(weekendSlots, activeCount)
  const fBudget = fridayBudget(fridaySlots, activeCount)
  const maxDaySlots = Math.max(
    ctx.slots.openDutySlots,
    ctx.slots.postOpenDutySlots,
    ctx.slots.closedDutySlots,
  )

  // Strict rule: every day must reach its minimum (open minimum on open days,
  // post-open minimum on the day right after them, closed minimum on all
  // others). Open on-call days and the day right after
  // them (critical days) are filled first, and fairness caps never block
  // them. Only the hard constraints (availability, monthly cap, open on-call
  // cap, no back-to-back) can leave a day short, which surfaces as a
  // conflict. Slots above the minimum, up to the day's slot count, are filled
  // afterwards on a best-effort basis, so a doctor spent on an optional slot
  // can never cost another day its minimum.
  const criticalDates = new Set(
    ctx.days.filter((d) => requiresDoubleCoverage(d.date, ctx.openDuty)).map((d) => d.date),
  )
  const criticalDays = ctx.days.filter((d) => criticalDates.has(d.date))
  const regularDays = ctx.days.filter((d) => !criticalDates.has(d.date))
  const passes = [
    { group: criticalDays, required: true },
    { group: regularDays, required: true },
    { group: criticalDays, required: false },
    { group: regularDays, required: false },
  ]
  for (const { group, required } of passes) {
    for (let slot = 0; slot < maxDaySlots; slot++) {
      for (const day of group) {
        if ((state.byDate.get(day.date)?.size ?? 0) !== slot) continue
        const minimum = minimumForDate(day.date, ctx.openDuty, ctx.minimums)
        // Required passes stop at the minimum. Optional passes start there and
        // skip days already short of it — those are reported as conflicts.
        const skip = required
          ? slot >= minimum
          : slot < minimum || slot >= slotsForDate(day.date, ctx.openDuty, ctx.slots)
        if (skip) continue
        fillDay(day, criticalDates.has(day.date), required)
      }
    }
  }

  return { assignments, conflicts }

  /**
   * Assigns the single best-scoring eligible doctor to `day`. When nobody
   * qualifies, a `required` slot (below the day's minimum) is recorded as a
   * conflict; an optional slot is simply left empty.
   */
  function fillDay(day: DaySpec, critical: boolean, required: boolean): void {
    const openDay = isOpenDutyDate(day.date, ctx.openDuty.anchorDate, ctx.openDuty.intervalDays)

    /** Constraint pass over the doctor pool; `relaxFairness` skips the
     * holiday cap (it yields to the day-fill rule). */
    const collect = (relaxFairness: boolean): { eligible: Eligible[]; tally: ConflictTally } => {
      const eligible: Eligible[] = []
      const tally = emptyTally()
      for (const doctor of ctx.doctors) {
        const blocked = blockingRule(ctx, state, doctor, day, critical, relaxFairness)
        if (blocked) {
          tally[blocked]++
          continue
        }
        eligible.push({
          doctor,
          score: scoreCandidate(
            doctor,
            day,
            state.total.get(doctor.id) ?? 0,
            state.weekend.get(doctor.id) ?? 0,
            state.friday.get(doctor.id) ?? 0,
            wBudget,
            fBudget,
            state.weekday.get(doctor.id)?.[day.dayOfWeek] ?? 0,
          ),
        })
      }
      return { eligible, tally }
    }

    let { eligible, tally } = collect(false)
    let relaxedFill = false
    // Strict rule — minimum-coverage guarantee: every day reaches its
    // minimum, the same tier as the no-back-to-back rule. Before a regular
    // day is left below its minimum, the fairness caps above give way; the
    // hard constraints (availability, monthly cap, open on-call cap, no
    // back-to-back) never do. Optional slots never relax: eligibility only
    // shrinks as the run proceeds, so a day that needed the relaxation never
    // gains a doctor beyond its minimum.
    if (eligible.length === 0 && required && !critical) {
      const retry = collect(true)
      eligible = retry.eligible
      tally = retry.tally
      relaxedFill = eligible.length > 0
    }

    if (eligible.length === 0) {
      if (required)
        conflicts.push({
          date: day.date,
          critical,
          required: minimumForDate(day.date, ctx.openDuty, ctx.minimums),
          assigned: state.byDate.get(day.date)?.size ?? 0,
          activeDoctors: activeCount,
          tally,
        })
      return
    }

    eligible.sort(
      (a, b) =>
        b.score.score - a.score.score ||
        (state.total.get(a.doctor.id) ?? 0) - (state.total.get(b.doctor.id) ?? 0) ||
        (state.weekend.get(a.doctor.id) ?? 0) - (state.weekend.get(b.doctor.id) ?? 0) ||
        a.doctor.id - b.doctor.id,
    )

    const winner = eligible[0]!
    assignments.push({
      date: day.date,
      doctorId: winner.doctor.id,
      doctorFirstName: winner.doctor.firstName,
      doctorLastName: winner.doctor.lastName,
      isWeekend: day.isWeekend,
      reason: `score ${winner.score.score} (workload +${winner.score.workload}, weekend +${winner.score.weekend}, friday +${winner.score.friday}, first fri/sat/sun +${winner.score.friSatSun})${describeTiebreak(winner, eligible, state.total, state.weekend)}${relaxedFill ? '; day-fill guarantee overrode fairness caps' : ''}`,
    })
    state.total.set(winner.doctor.id, (state.total.get(winner.doctor.id) ?? 0) + 1)
    const perWeekday = state.weekday.get(winner.doctor.id)
    if (perWeekday) perWeekday[day.dayOfWeek] = (perWeekday[day.dayOfWeek] ?? 0) + 1
    state.byDate.set(day.date, (state.byDate.get(day.date) ?? new Set()).add(winner.doctor.id))
    if (day.isWeekend)
      state.weekend.set(winner.doctor.id, (state.weekend.get(winner.doctor.id) ?? 0) + 1)
    if (day.dayOfWeek === 5)
      state.friday.set(winner.doctor.id, (state.friday.get(winner.doctor.id) ?? 0) + 1)
    if (day.isHoliday)
      state.holiday.set(winner.doctor.id, (state.holiday.get(winner.doctor.id) ?? 0) + 1)
    if (openDay)
      state.openDays.set(winner.doctor.id, (state.openDays.get(winner.doctor.id) ?? 0) + 1)
  }
}

function describeTiebreak(
  winner: Eligible,
  eligible: Eligible[],
  totals: Map<number, number>,
  weekends: Map<number, number>,
): string {
  const sameScore = eligible.filter(
    (e) => e.doctor.id !== winner.doctor.id && e.score.score === winner.score.score,
  )
  if (sameScore.length === 0) return ''
  for (const o of sameScore) {
    if ((totals.get(winner.doctor.id) ?? 0) !== (totals.get(o.doctor.id) ?? 0))
      return '; tie-break: fewer duties'
    if ((weekends.get(winner.doctor.id) ?? 0) !== (weekends.get(o.doctor.id) ?? 0))
      return '; tie-break: fewer weekend duties'
  }
  return '; tie-break: lower id'
}
