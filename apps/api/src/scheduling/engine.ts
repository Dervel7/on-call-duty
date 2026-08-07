import { prevDate } from './dates'
import { isAvailable, notConsecutive, underCap } from './constraints'
import { holidayBudget, scoreCandidate, weekendBudget } from './scoring'
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
  byDate: Map<string, number>
}

export function generate(ctx: SchedulingContext): GenerateResult {
  const assignments: AssignmentPlan[] = []
  const conflicts: ConflictPlan[] = []

  const state: RunState = {
    total: new Map(),
    weekend: new Map(),
    holiday: new Map(),
    byDate: new Map(),
  }
  for (const d of ctx.doctors) {
    state.total.set(d.id, 0)
    state.weekend.set(d.id, 0)
    state.holiday.set(d.id, 0)
  }

  const activeCount = ctx.doctors.length
  const weekendDays = ctx.days.filter((d) => d.isWeekend).length
  const holidayDays = ctx.days.filter((d) => d.isHoliday).length
  const wBudget = weekendBudget(weekendDays, activeCount)
  const hBudget = holidayBudget(holidayDays, activeCount)
  const firstDay = ctx.days[0]
  const firstDayPrev = firstDay ? prevDate(firstDay.date) : ''

  for (const day of ctx.days) {
    const eligible: Eligible[] = []
    const tally = { unavailable: 0, 'at cap': 0, 'back-to-back': 0 }

    for (const doctor of ctx.doctors) {
      const ranges = ctx.unavailability.get(doctor.id)
      const avail = isAvailable(doctor.id, day.date, ranges)
      if (!avail.ok) {
        tally.unavailable++
        continue
      }
      const cap = underCap(state.total.get(doctor.id) ?? 0, doctor.maxMonthlyDuties)
      if (!cap.ok) {
        tally['at cap']++
        continue
      }
      const prev = prevDate(day.date)
      const onDutyYesterday =
        prev === firstDayPrev
          ? ctx.priorDayDoctorIds.has(doctor.id)
          : state.byDate.get(prev) === doctor.id
      const consec = notConsecutive(onDutyYesterday)
      if (!consec.ok) {
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
          wBudget,
          hBudget,
        ),
      })
    }

    if (eligible.length === 0) {
      conflicts.push({
        date: day.date,
        detail: `of ${activeCount} active doctor(s): ${tally.unavailable} unavailable, ${tally['at cap']} at cap, ${tally['back-to-back']} back-to-back`,
      })
      continue
    }

    eligible.sort(
      (a, b) =>
        b.score.score - a.score.score ||
        (state.total.get(a.doctor.id) ?? 0) - (state.total.get(b.doctor.id) ?? 0) ||
        (state.weekend.get(a.doctor.id) ?? 0) - (state.weekend.get(b.doctor.id) ?? 0) ||
        a.doctor.id - b.doctor.id,
    )

    const winner = eligible[0]
    if (!winner) continue

    assignments.push({
      date: day.date,
      doctorId: winner.doctor.id,
      doctorFirstName: winner.doctor.firstName,
      doctorLastName: winner.doctor.lastName,
      isWeekend: day.isWeekend,
      isHoliday: day.isHoliday,
      reason: `score ${winner.score.score} (workload +${winner.score.workload}, weekend +${winner.score.weekend}, holiday +${winner.score.holiday})${describeTiebreak(winner, eligible, state)}`,
    })

    state.total.set(winner.doctor.id, (state.total.get(winner.doctor.id) ?? 0) + 1)
    state.byDate.set(day.date, winner.doctor.id)
    if (day.isWeekend)
      state.weekend.set(winner.doctor.id, (state.weekend.get(winner.doctor.id) ?? 0) + 1)
    if (day.isHoliday)
      state.holiday.set(winner.doctor.id, (state.holiday.get(winner.doctor.id) ?? 0) + 1)
  }

  return { assignments, conflicts }
}

function describeTiebreak(winner: Eligible, eligible: Eligible[], state: RunState): string {
  const sameScore = eligible.filter(
    (e) => e.doctor.id !== winner.doctor.id && e.score.score === winner.score.score,
  )
  if (sameScore.length === 0) return ''
  for (const o of sameScore) {
    if ((state.total.get(winner.doctor.id) ?? 0) !== (state.total.get(o.doctor.id) ?? 0))
      return '; tie-break: fewer duties'
    if ((state.weekend.get(winner.doctor.id) ?? 0) !== (state.weekend.get(o.doctor.id) ?? 0))
      return '; tie-break: fewer weekend duties'
  }
  return '; tie-break: lower id'
}
