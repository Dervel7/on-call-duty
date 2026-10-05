import {
  isOpenDutyDate,
  minimumForDate,
  nextDate,
  requiresDoubleCoverage,
  slotsForDate,
} from './dates'
import { HOLIDAY_DUTY_CAP, OPEN_DUTY_DUTY_CAP, isAvailable } from './constraints'
import { isFriSatSun } from './scoring'
import type { DaySpec, DoctorSpec, SchedulingContext } from './types'

/**
 * MIP model of the scheduling rules in CPLEX LP text, one text per stage.
 *
 * The `capacity` stage measures each doctor's capacity: the most duties they
 * could take on their own under every per-doctor rule, with no fairness
 * relaxation. The other stages are lexicographic objectives, highest
 * priority first (design levels 1-6):
 *
 * 1. `cover-*`: minimum coverage, in the greedy fill order. Critical days
 *    (open on-call days and the day after) reach their minimum first; then
 *    every regular day gets its first doctor before any gets a second.
 * 2. `relax`: fewest holiday-cap and Fri/Sat/Sun-repeat relaxations, which
 *    are only allowed where coverage needs them
 * 3. `weekdays`: fewest missing first Friday / Saturday / Sunday per doctor
 * 4. `share`: smallest deviation from each doctor's fair share of all duties
 * 5. `holidays`: smallest holiday-duty spread between doctors
 * 6. `fill`: most duties (fill extra slots)
 *
 * Each stage keeps every earlier stage at its optimum through a bound row.
 * Names and row order are deterministic: doctors by id, dates ascending.
 */

export type Stage =
  | 'capacity'
  | `cover-critical-${number}`
  | `cover-regular-${number}`
  | 'relax'
  | 'weekdays'
  | 'share'
  | 'holidays'
  | 'fill'

/** The Fri/Sat/Sun weekdays of the one-each-per-month goal. */
export const FRI_SAT_SUN = [
  { dayOfWeek: 5, code: 'fri', name: 'friday' },
  { dayOfWeek: 6, code: 'sat', name: 'saturday' },
  { dayOfWeek: 0, code: 'sun', name: 'sunday' },
] as const

export interface ModelDay {
  day: DaySpec
  /** Open on-call day or the day right after one. */
  critical: boolean
  open: boolean
  slots: number
  minimum: number
}

/** One possible duty: a doctor who may be assigned to a day. */
export interface ModelCell {
  doctorId: number
  day: ModelDay
  /** LP variable name, `x_<doctorId>_<yyyymmdd>`. */
  name: string
}

export interface ModelIndex {
  /** Doctors by id. */
  doctors: DoctorSpec[]
  days: ModelDay[]
  /** Each doctor's cells, dates ascending. */
  cellsByDoctor: Map<number, ModelCell[]>
  /** Each date's cells, doctor id ascending. */
  cellsByDate: Map<string, ModelCell[]>
  /** Solve order, starting with `capacity`. */
  stages: Stage[]
}

export interface ModelBounds {
  /** Optimum of every solved stage before the one being built. */
  optima: ReadonlyMap<Stage, number>
  /** Capacity-stage result per doctor id; required from the `share` stage on. */
  capacity: ReadonlyMap<number, number>
}

/**
 * Classifies the days and lists every possible duty. Days the doctor is
 * unavailable, and the first day when they held the previous month's last
 * day, get no variable at all.
 */
export function indexModel(ctx: SchedulingContext): ModelIndex {
  const doctors = [...ctx.doctors].sort((a, b) => a.id - b.id)
  const days: ModelDay[] = ctx.days.map((day) => ({
    day,
    critical: requiresDoubleCoverage(day.date, ctx.openDuty),
    open: isOpenDutyDate(day.date, ctx.openDuty.anchorDate, ctx.openDuty.intervalDays),
    slots: slotsForDate(day.date, ctx.openDuty, ctx.slots),
    minimum: minimumForDate(day.date, ctx.openDuty, ctx.minimums),
  }))
  const firstDate = ctx.days[0]?.date
  const cellsByDoctor = new Map<number, ModelCell[]>()
  const cellsByDate = new Map<string, ModelCell[]>(days.map((d) => [d.day.date, []]))
  for (const doctor of doctors) {
    const cells: ModelCell[] = []
    for (const d of days) {
      if (!isAvailable(doctor.id, d.day.date, ctx.unavailability.get(doctor.id)).ok) continue
      if (d.day.date === firstDate && ctx.priorDayDoctorIds.has(doctor.id)) continue
      const cell = { doctorId: doctor.id, day: d, name: `x_${doctor.id}_${d.day.date.replaceAll('-', '')}` }
      cells.push(cell)
      cellsByDate.get(d.day.date)?.push(cell)
    }
    cellsByDoctor.set(doctor.id, cells)
  }
  const positions = (critical: boolean): number[] => {
    const deepest = Math.max(0, ...days.filter((d) => d.critical === critical).map((d) => d.minimum))
    return Array.from({ length: deepest }, (_, i) => i + 1)
  }
  const stages: Stage[] = [
    'capacity',
    ...positions(true).map((p): Stage => `cover-critical-${p}`),
    ...positions(false).map((p): Stage => `cover-regular-${p}`),
    'relax',
    'weekdays',
    'share',
    'holidays',
    'fill',
  ]
  return { doctors, days, cellsByDoctor, cellsByDate, stages }
}

type Term = readonly [coefficient: number, variable: string]

const TERMS_PER_LINE = 10

function linear(terms: readonly Term[]): string {
  let text = ''
  terms.forEach(([coefficient, variable], i) => {
    const sign = coefficient < 0 ? '-' : '+'
    const size = Math.abs(coefficient) === 1 ? '' : `${Math.abs(coefficient)} `
    const gap = i === 0 ? '' : i % TERMS_PER_LINE === 0 ? '\n   ' : ' '
    text += `${gap}${i === 0 && sign === '+' ? '' : `${sign} `}${size}${variable}`
  })
  return text
}

const ones = (cells: readonly ModelCell[]): Term[] => cells.map((c) => [1, c.name])

/** A doctor's cells on one Fri/Sat/Sun weekday. */
export const sameWeekday = (cells: readonly ModelCell[], dayOfWeek: number): ModelCell[] =>
  cells.filter((c) => isFriSatSun(c.day.day) && c.day.day.dayOfWeek === dayOfWeek)

class LpText {
  readonly rows: string[] = []
  readonly bounds: string[] = []
  readonly binaries: string[] = []
  readonly generals: string[] = []

  row(name: string, terms: readonly Term[], op: '<=' | '>=' | '=', rhs: number): void {
    this.rows.push(` ${name}: ${linear(terms)} ${op} ${rhs}`)
  }

  integer(name: string, upper: number): void {
    this.generals.push(name)
    this.bounds.push(` 0 <= ${name} <= ${upper}`)
  }

  render(sense: 'Minimize' | 'Maximize', objective: readonly Term[]): string {
    const wrap = (names: string[]): string =>
      names.map((n, i) => (i > 0 && i % TERMS_PER_LINE === 0 ? `\n ${n}` : ` ${n}`)).join('')
    return [
      sense,
      ` obj: ${linear(objective)}`,
      'Subject To',
      ...this.rows,
      ...(this.bounds.length > 0 ? ['Bounds', ...this.bounds] : []),
      ...(this.binaries.length > 0 ? ['Binary', wrap(this.binaries)] : []),
      ...(this.generals.length > 0 ? ['General', wrap(this.generals)] : []),
      'End',
      '',
    ].join('\n')
  }
}

/**
 * LP text for `stage`, or null when the stage has nothing to optimize (for
 * example no Fri/Sat/Sun duty is possible), so the caller skips it.
 */
export function buildModel(index: ModelIndex, stage: Stage, bounds: ModelBounds): string | null {
  const lp = new LpText()
  const rank = index.stages.indexOf(stage)
  const reached = (s: Stage): boolean => index.stages.indexOf(s) <= rank
  const relax = stage !== 'capacity'
  const allCells = [...index.cellsByDoctor.values()].flat()
  lp.binaries.push(...allCells.map((c) => c.name))

  // Objective terms of every minimized stage, in solve order.
  const objectives = new Map<Stage, Term[]>(index.stages.map((s) => [s, []]))
  const add = (s: Stage, term: Term): void => {
    objectives.get(s)?.push(term)
  }

  // Hard per-doctor rules, the holiday cap, and the Fri/Sat/Sun repeat cap.
  for (const doctor of index.doctors) {
    const id = doctor.id
    const cells = index.cellsByDoctor.get(id) ?? []
    if (cells.length === 0) continue
    lp.row(`cap_${id}`, ones(cells), '<=', doctor.maxMonthlyDuties)

    const byDate = new Map(cells.map((c) => [c.day.day.date, c]))
    for (const c of cells) {
      const next = byDate.get(nextDate(c.day.day.date))
      if (next) lp.row(`b2b_${c.name.slice(2)}`, [[1, c.name], [1, next.name]], '<=', 1)
    }

    const open = cells.filter((c) => c.day.open)
    if (open.length > OPEN_DUTY_DUTY_CAP) lp.row(`open_${id}`, ones(open), '<=', OPEN_DUTY_DUTY_CAP)

    // Holiday cap: non-critical holiday duties n <= max(0, cap - c) + over,
    // c = critical holiday duties (exempt from the cap but counted). The
    // binary picks the c > cap branch, which allows no non-critical holiday.
    const nonCritical = cells.filter((c) => c.day.day.isHoliday && !c.day.critical)
    const critical = cells.filter((c) => c.day.day.isHoliday && c.day.critical)
    if (nonCritical.length > 0 && nonCritical.length + critical.length > HOLIDAY_DUTY_CAP) {
      const over: Term[] = []
      if (relax) {
        lp.integer(`ho_${id}`, nonCritical.length)
        over.push([-1, `ho_${id}`])
        add('relax', [1, `ho_${id}`])
      }
      if (critical.length === 0) {
        lp.row(`hol_${id}`, [...ones(nonCritical), ...over], '<=', HOLIDAY_DUTY_CAP)
      } else {
        const m = nonCritical.length + critical.length
        lp.binaries.push(`hb_${id}`)
        lp.row(
          `hol_${id}`,
          [...ones(nonCritical), ...ones(critical), [-m, `hb_${id}`], ...over],
          '<=',
          HOLIDAY_DUTY_CAP,
        )
        lp.row(`holb_${id}`, [...ones(nonCritical), [m, `hb_${id}`], ...over], '<=', m)
      }
    }

    // D2: at most one duty per Fri/Sat/Sun weekday unless coverage needs more.
    for (const w of FRI_SAT_SUN) {
      const same = sameWeekday(cells, w.dayOfWeek)
      if (same.length < 2) continue
      const repeat: Term[] = []
      if (relax) {
        lp.integer(`rp_${id}_${w.code}`, same.length - 1)
        repeat.push([-1, `rp_${id}_${w.code}`])
        add('relax', [1, `rp_${id}_${w.code}`])
      }
      lp.row(`rep_${id}_${w.code}`, [...ones(same), ...repeat], '<=', 1)
    }
  }

  if (stage === 'capacity') return allCells.length > 0 ? lp.render('Maximize', ones(allCells)) : null

  // Day capacity and minimum coverage. `u_<date>_<p>` is 1 when the day has
  // fewer than p doctors; the cover stages minimize these position by position.
  for (const d of index.days) {
    const cells = index.cellsByDate.get(d.day.date) ?? []
    const key = d.day.date.replaceAll('-', '')
    if (cells.length > d.slots) lp.row(`slots_${key}`, ones(cells), '<=', d.slots)
    for (let p = 1; p <= d.minimum; p++) {
      const unmet = `u_${key}_${p}`
      lp.binaries.push(unmet)
      lp.row(`cover_${key}_${p}`, [...ones(cells), [p, unmet]], '>=', p)
      add(d.critical ? `cover-critical-${p}` : `cover-regular-${p}`, [1, unmet])
    }
  }

  if (reached('weekdays')) {
    for (const doctor of index.doctors) {
      for (const w of FRI_SAT_SUN) {
        const same = sameWeekday(index.cellsByDoctor.get(doctor.id) ?? [], w.dayOfWeek)
        if (same.length === 0) continue
        const miss = `ms_${doctor.id}_${w.code}`
        lp.bounds.push(` 0 <= ${miss} <= 1`)
        lp.row(`miss_${doctor.id}_${w.code}`, [...ones(same), [1, miss]], '>=', 1)
        add('weekdays', [1, miss])
      }
    }
  }

  if (reached('share')) {
    // Fair share: each doctor's total t stays less than one duty away from
    // total * capacity / E, E = sum of capacities: |E*t - capacity*total| <=
    // E - 1 + dev, so integer coefficients and `dev` is the excess in 1/E
    // duty units. A doctor's own limits (monthly cap, unavailability) lower
    // their share instead of pulling everyone else down.
    const shared = index.doctors.filter((d) => (bounds.capacity.get(d.id) ?? 0) > 0)
    if (shared.length >= 2) {
      const e = shared.reduce((sum, d) => sum + (bounds.capacity.get(d.id) ?? 0), 0)
      lp.row('tot', [[1, 'total'], ...shared.map((d): Term => [-1, `t_${d.id}`])], '=', 0)
      for (const d of shared) {
        const cap = bounds.capacity.get(d.id) ?? 0
        const t = `t_${d.id}`
        const cells = index.cellsByDoctor.get(d.id) ?? []
        lp.row(`tdef_${d.id}`, [[1, t], ...cells.map((c): Term => [-1, c.name])], '=', 0)
        lp.row(`fshi_${d.id}`, [[e, t], [-cap, 'total'], [-1, 'dev']], '<=', e - 1)
        lp.row(`fslo_${d.id}`, [[e, t], [-cap, 'total'], [1, 'dev']], '>=', -(e - 1))
      }
      add('share', [1, 'dev'])
    }
  }

  if (reached('holidays')) {
    // Holiday spread above 1: an uneven split is unavoidable when the holiday
    // duties do not divide evenly between the doctors.
    const holidayCells = index.doctors
      .map((d) => ({ id: d.id, cells: (index.cellsByDoctor.get(d.id) ?? []).filter((c) => c.day.day.isHoliday) }))
      .filter((h) => h.cells.length > 0)
    if (holidayCells.length >= 2) {
      for (const h of holidayCells) {
        lp.row(`hlo_${h.id}`, [...ones(h.cells), [-1, 'hmin']], '>=', 0)
        lp.row(`hhi_${h.id}`, [...ones(h.cells), [-1, 'hmax']], '<=', 0)
      }
      lp.row('hspread', [[1, 'hmax'], [-1, 'hmin'], [-1, 'hex']], '<=', 1)
      add('holidays', [1, 'hex'])
    }
  }

  for (const [s, terms] of objectives) {
    const optimum = bounds.optima.get(s)
    if (index.stages.indexOf(s) < rank && optimum !== undefined && terms.length > 0)
      lp.row(`bound_${s.replaceAll('-', '_')}`, terms, '<=', optimum)
  }

  if (stage === 'fill') return allCells.length > 0 ? lp.render('Maximize', ones(allCells)) : null
  const objective = objectives.get(stage) ?? []
  return objective.length > 0 ? lp.render('Minimize', objective) : null
}
