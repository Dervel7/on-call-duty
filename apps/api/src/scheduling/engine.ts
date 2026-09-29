import { isOpenDutyDate, nextDate, prevDate, requiresDoubleCoverage } from './dates'
import {
  balanceCap,
  DOCTORS_PER_DAY,
  isAvailable,
  notConsecutive,
  underCap,
  underHolidayCap,
  underOpenDutyCap,
} from './constraints'
import { scoreCandidate, weekendBudget, fridayBudget } from './scoring'
import type {
  AssignmentPlan,
  CandidateScore,
  ConflictPlan,
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
  saturday: Map<number, number>
  sunday: Map<number, number>
  friday: Map<number, number>
  holiday: Map<number, number>
  openDays: Map<number, number>
  byDate: Map<string, Set<number>>
}

interface Tally {
  unavailable: number
  'at cap': number
  'at open on-call cap': number
  'at weekend cap': number
  'at holiday cap': number
  'back-to-back': number
  'already on duty': number
}

/** Per-doctor upper bounds derived from the ±1 balance rule, fixed for the run. */
interface BalanceCaps {
  saturday: number
  sunday: number
}

function balanceCaps(ctx: SchedulingContext): BalanceCaps {
  const doctors = ctx.doctors.length
  const saturdays = ctx.days.filter((d) => d.dayOfWeek === 6).length
  const sundays = ctx.days.filter((d) => d.dayOfWeek === 0).length
  return {
    saturday: balanceCap(DOCTORS_PER_DAY * saturdays, doctors),
    sunday: balanceCap(DOCTORS_PER_DAY * sundays, doctors),
  }
}

export function generate(ctx: SchedulingContext): GenerateResult {
  const assignments: AssignmentPlan[] = []
  const conflicts: ConflictPlan[] = []

  const state: RunState = {
    total: new Map(),
    weekend: new Map(),
    saturday: new Map(),
    sunday: new Map(),
    friday: new Map(),
    holiday: new Map(),
    openDays: new Map(),
    byDate: new Map(),
  }
  for (const d of ctx.doctors) {
    state.total.set(d.id, 0)
    state.weekend.set(d.id, 0)
    state.saturday.set(d.id, 0)
    state.sunday.set(d.id, 0)
    state.friday.set(d.id, 0)
    state.holiday.set(d.id, 0)
    state.openDays.set(d.id, 0)
  }

  const activeCount = ctx.doctors.length
  const weekendDays = ctx.days.filter((d) => d.isWeekend).length
  const fridayDays = ctx.days.filter((d) => d.dayOfWeek === 5).length
  const wBudget = weekendBudget(weekendDays, activeCount)
  const fBudget = fridayBudget(fridayDays, activeCount)
  const caps = balanceCaps(ctx)
  const firstDay = ctx.days[0]
  const firstDayPrev = firstDay ? prevDate(firstDay.date) : ''

  // Strict rule: open on-call days and the day right after them always carry
  // 2 doctors. They are filled first — both slots before any regular day gets
  // a single one — and fairness caps never block them. Only the hard
  // constraints (availability, monthly cap, no back-to-back) can leave one
  // short, which surfaces as a conflict.
  const criticalDates = new Set(
    ctx.days.filter((d) => requiresDoubleCoverage(d.date, ctx.openDuty)).map((d) => d.date),
  )
  const criticalDays = ctx.days.filter((d) => criticalDates.has(d.date))
  const regularDays = ctx.days.filter((d) => !criticalDates.has(d.date))
  for (const group of [criticalDays, regularDays]) {
    for (let slot = 0; slot < DOCTORS_PER_DAY; slot++) {
      for (const day of group) {
        if ((state.byDate.get(day.date)?.size ?? 0) !== slot) continue
        fillDay(day, criticalDates.has(day.date))
      }
    }
  }

  return { assignments, conflicts }

  /** Assigns the single best-scoring eligible doctor to `day`, or records why nobody could. */
  function fillDay(day: DaySpec, critical: boolean): void {
    const eligible: Eligible[] = []
    const tally: Tally = {
      unavailable: 0,
      'at cap': 0,
      'at open on-call cap': 0,
      'at weekend cap': 0,
      'at holiday cap': 0,
      'already on duty': 0,
      'back-to-back': 0,
    }
    const openDay = isOpenDutyDate(day.date, ctx.openDuty.anchorDate, ctx.openDuty.intervalDays)


    for (const doctor of ctx.doctors) {
      if (state.byDate.get(day.date)?.has(doctor.id)) {
        tally['already on duty']++
        continue
      }
      const ranges = ctx.unavailability.get(doctor.id)
      if (!isAvailable(doctor.id, day.date, ranges).ok) {
        tally.unavailable++
        continue
      }
      if (!underCap(state.total.get(doctor.id) ?? 0, doctor.maxMonthlyDuties).ok) {
        tally['at cap']++
        continue
      }
      // Strict rule: one open on-call duty per doctor per schedule. A second
      // is never allowed — not even to complete an open day's required
      // double coverage — so it outranks the fairness relaxations below.
      if (openDay && !underOpenDutyCap(state.openDays.get(doctor.id) ?? 0).ok) {
        tally['at open on-call cap']++
        continue
      }
      // Fairness caps (±1 weekend balance, holiday cap) never block the
      // strict open on-call rule; hard constraints still apply everywhere.
      if (
        !critical &&
        day.dayOfWeek === 6 &&
        !underCap(state.saturday.get(doctor.id) ?? 0, caps.saturday).ok
      ) {
        tally['at weekend cap']++
        continue
      }
      if (
        !critical &&
        day.dayOfWeek === 0 &&
        !underCap(state.sunday.get(doctor.id) ?? 0, caps.sunday).ok
      ) {
        tally['at weekend cap']++
        continue
      }
      if (day.isHoliday && !critical && !underHolidayCap(state.holiday.get(doctor.id) ?? 0).ok) {
        tally['at holiday cap']++
        continue
      }
       const prev = prevDate(day.date)
      const onDutyYesterday =
        prev === firstDayPrev
          ? ctx.priorDayDoctorIds.has(doctor.id)
          : state.byDate.get(prev)?.has(doctor.id) ?? false
      // Later slot passes must also look at the next day: it may already
      // hold an earlier-pass duty, and the pair would be back-to-back.
      const onDutyTomorrow = state.byDate.get(nextDate(day.date))?.has(doctor.id) ?? false
      if (!notConsecutive(onDutyYesterday || onDutyTomorrow).ok) {
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
          state.friday.get(doctor.id) ?? 0,
          wBudget,
          fBudget,
        ),
      })
    }

    if (eligible.length === 0) {
      conflicts.push(
        conflictFor(day.date, activeCount, tally, state.byDate.get(day.date)?.size ?? 0, critical),
      )
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
      reason: `score ${winner.score.score} (workload +${winner.score.workload}, weekend +${winner.score.weekend}, friday +${winner.score.friday})${describeTiebreak(winner, eligible, state.total, state.weekend)}`,
    })
    state.total.set(winner.doctor.id, (state.total.get(winner.doctor.id) ?? 0) + 1)
    state.byDate.set(day.date, (state.byDate.get(day.date) ?? new Set()).add(winner.doctor.id))
    if (day.isWeekend)
      state.weekend.set(winner.doctor.id, (state.weekend.get(winner.doctor.id) ?? 0) + 1)
    if (day.dayOfWeek === 6)
      state.saturday.set(winner.doctor.id, (state.saturday.get(winner.doctor.id) ?? 0) + 1)
    if (day.dayOfWeek === 0)
      state.sunday.set(winner.doctor.id, (state.sunday.get(winner.doctor.id) ?? 0) + 1)
     if (day.dayOfWeek === 5)
       state.friday.set(winner.doctor.id, (state.friday.get(winner.doctor.id) ?? 0) + 1)
    if (day.isHoliday)
      state.holiday.set(winner.doctor.id, (state.holiday.get(winner.doctor.id) ?? 0) + 1)
    if (openDay)
      state.openDays.set(winner.doctor.id, (state.openDays.get(winner.doctor.id) ?? 0) + 1)
  }
}

function conflictFor(
  date: string,
  activeCount: number,
  tally: Tally,
  assigned: number,
  critical: boolean,
): ConflictPlan {
  // Only top-up passes can skip a doctor because they already hold this day's
  // other slot; keep the detail identical to the classic format otherwise.
  const onDutyNote =
    tally['already on duty'] > 0 ? `, ${tally['already on duty']} already on duty` : ''
  const rule = critical ? 'requires 2 doctors (open on-call rule); ' : ''
  return {
    date,
    detail: `${rule}only ${assigned} of ${DOCTORS_PER_DAY} doctors assigned; of ${activeCount} active doctor(s): ${tally.unavailable} unavailable, ${tally['at cap']} at monthly cap, ${tally['at open on-call cap']} at open on-call cap, ${tally['at weekend cap']} at weekend cap, ${tally['at holiday cap']} at holiday cap, ${tally['back-to-back']} back-to-back${onDutyNote}`,
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
