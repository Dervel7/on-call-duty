import { prevDate } from './dates'
import {
  balanceCap,
  DOCTORS_PER_DAY,
  isAvailable,
  notConsecutive,
  underCap,
} from './constraints'
import { holidayBudget, scoreCandidate, weekendBudget, fridayBudget } from './scoring'
import type {
  AssignmentPlan,
  CandidateScore,
  ConflictPlan,
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
  holiday: Map<number, number>
  saturday: Map<number, number>
  sunday: Map<number, number>
  friday: Map<number, number>
  byDate: Map<string, Set<number>>
}

interface Tally {
  unavailable: number
  'at cap': number
  'at weekend cap': number
  'at holiday cap': number
  'back-to-back': number
}

/** Per-doctor upper bounds derived from the ±1 balance rule, fixed for the run. */
interface BalanceCaps {
  saturday: number
  sunday: number
  holiday: number
}

function balanceCaps(ctx: SchedulingContext): BalanceCaps {
  const doctors = ctx.doctors.length
  const saturdays = ctx.days.filter((d) => d.dayOfWeek === 6).length
  const sundays = ctx.days.filter((d) => d.dayOfWeek === 0).length
  const holidays = ctx.days.filter((d) => d.isHoliday).length
  return {
    saturday: balanceCap(DOCTORS_PER_DAY * saturdays, doctors),
    sunday: balanceCap(DOCTORS_PER_DAY * sundays, doctors),
    holiday: balanceCap(DOCTORS_PER_DAY * holidays, doctors),
  }
}

export function generate(ctx: SchedulingContext): GenerateResult {
  const assignments: AssignmentPlan[] = []
  const conflicts: ConflictPlan[] = []

  const state: RunState = {
    total: new Map(),
    weekend: new Map(),
    holiday: new Map(),
    saturday: new Map(),
    sunday: new Map(),
    friday: new Map(),
    byDate: new Map(),
  }
  for (const d of ctx.doctors) {
    state.total.set(d.id, 0)
    state.weekend.set(d.id, 0)
    state.holiday.set(d.id, 0)
    state.saturday.set(d.id, 0)
    state.sunday.set(d.id, 0)
    state.friday.set(d.id, 0)
  }

  const activeCount = ctx.doctors.length
  const weekendDays = ctx.days.filter((d) => d.isWeekend).length
  const holidayDays = ctx.days.filter((d) => d.isHoliday).length
  const fridayDays = ctx.days.filter((d) => d.dayOfWeek === 5).length
  const wBudget = weekendBudget(weekendDays, activeCount)
  const hBudget = holidayBudget(holidayDays, activeCount)
  const fBudget = fridayBudget(fridayDays, activeCount)
  const caps = balanceCaps(ctx)
  const firstDay = ctx.days[0]
  const firstDayPrev = firstDay ? prevDate(firstDay.date) : ''

  for (const day of ctx.days) {
    const eligible: Eligible[] = []
    const tally: Tally = {
      unavailable: 0,
      'at cap': 0,
      'at weekend cap': 0,
      'at holiday cap': 0,
      'back-to-back': 0,
    }

    for (const doctor of ctx.doctors) {
      const ranges = ctx.unavailability.get(doctor.id)
      if (!isAvailable(doctor.id, day.date, ranges).ok) {
        tally.unavailable++
        continue
      }
      if (!underCap(state.total.get(doctor.id) ?? 0, doctor.maxMonthlyDuties).ok) {
        tally['at cap']++
        continue
      }
      if (day.dayOfWeek === 6 && !underCap(state.saturday.get(doctor.id) ?? 0, caps.saturday).ok) {
        tally['at weekend cap']++
        continue
      }
      if (day.dayOfWeek === 0 && !underCap(state.sunday.get(doctor.id) ?? 0, caps.sunday).ok) {
        tally['at weekend cap']++
        continue
      }
      if (day.isHoliday && !underCap(state.holiday.get(doctor.id) ?? 0, caps.holiday).ok) {
        tally['at holiday cap']++
        continue
      }
      const prev = prevDate(day.date)
      const onDutyYesterday =
        prev === firstDayPrev
          ? ctx.priorDayDoctorIds.has(doctor.id)
          : state.byDate.get(prev)?.has(doctor.id) ?? false
      if (!notConsecutive(onDutyYesterday).ok) {
        tally['back-to-back']++
        continue
      }
      eligible.push({
        doctor,
        score: scoreCandidate(
          doctor,
          day,
          state.total.get(doctor.id) ?? 0,
          state.weekend.get(doctor.id) ?? 0,
          state.holiday.get(doctor.id) ?? 0,
          state.friday.get(doctor.id) ?? 0,
          wBudget,
          hBudget,
          fBudget,
        ),
      })
    }

    if (eligible.length === 0) {
      conflicts.push(conflictFor(day.date, activeCount, tally, 0))
      continue
    }

    eligible.sort(
      (a, b) =>
        b.score.score - a.score.score ||
        (state.total.get(a.doctor.id) ?? 0) - (state.total.get(b.doctor.id) ?? 0) ||
        (state.weekend.get(a.doctor.id) ?? 0) - (state.weekend.get(b.doctor.id) ?? 0) ||
        (state.holiday.get(a.doctor.id) ?? 0) - (state.holiday.get(b.doctor.id) ?? 0) ||
        a.doctor.id - b.doctor.id,
    )

    // Snapshot the tallies the sort actually compared against, so persisted
    // reasons describe the real tie-break and not state mutated by the first
    // winner of the day.
    const totalsBefore = new Map(state.total)
    const weekendsBefore = new Map(state.weekend)
    const holidaysBefore = new Map(state.holiday)

    const winners = eligible.slice(0, DOCTORS_PER_DAY)
    for (const winner of winners) {
      assignments.push({
        date: day.date,
        doctorId: winner.doctor.id,
        doctorFirstName: winner.doctor.firstName,
        doctorLastName: winner.doctor.lastName,
        isWeekend: day.isWeekend,
        isHoliday: day.isHoliday,
        reason: `score ${winner.score.score} (workload +${winner.score.workload}, weekend +${winner.score.weekend}, holiday +${winner.score.holiday}, friday +${winner.score.friday})${describeTiebreak(winner, eligible, totalsBefore, weekendsBefore, holidaysBefore)}`,
      })
      state.total.set(winner.doctor.id, (state.total.get(winner.doctor.id) ?? 0) + 1)
      state.byDate.set(day.date, (state.byDate.get(day.date) ?? new Set()).add(winner.doctor.id))
      if (day.isWeekend)
        state.weekend.set(winner.doctor.id, (state.weekend.get(winner.doctor.id) ?? 0) + 1)
      if (day.isHoliday)
        state.holiday.set(winner.doctor.id, (state.holiday.get(winner.doctor.id) ?? 0) + 1)
      if (day.dayOfWeek === 6)
        state.saturday.set(winner.doctor.id, (state.saturday.get(winner.doctor.id) ?? 0) + 1)
      if (day.dayOfWeek === 0)
        state.sunday.set(winner.doctor.id, (state.sunday.get(winner.doctor.id) ?? 0) + 1)
      if (day.dayOfWeek === 5)
        state.friday.set(winner.doctor.id, (state.friday.get(winner.doctor.id) ?? 0) + 1)
    }

    if (winners.length < DOCTORS_PER_DAY) {
      conflicts.push(conflictFor(day.date, activeCount, tally, winners.length))
    }
  }

  return { assignments, conflicts }
}

function conflictFor(date: string, activeCount: number, tally: Tally, assigned: number): ConflictPlan {
  return {
    date,
    detail: `only ${assigned} of ${DOCTORS_PER_DAY} doctors assigned; of ${activeCount} active doctor(s): ${tally.unavailable} unavailable, ${tally['at cap']} at monthly cap, ${tally['at weekend cap']} at weekend cap, ${tally['at holiday cap']} at holiday cap, ${tally['back-to-back']} back-to-back`,
  }
}

function describeTiebreak(
  winner: Eligible,
  eligible: Eligible[],
  totals: Map<number, number>,
  weekends: Map<number, number>,
  holidays: Map<number, number>,
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
    if ((holidays.get(winner.doctor.id) ?? 0) !== (holidays.get(o.doctor.id) ?? 0))
      return '; tie-break: fewer holiday duties'
  }
  return '; tie-break: lower id'
}
