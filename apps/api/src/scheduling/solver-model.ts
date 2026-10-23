import {
  isOpenDutyDate,
  minimumForDate,
  nextDate,
  requiresDoubleCoverage,
  slotsForDate,
} from './dates.ts'
import { HOLIDAY_DUTY_CAP, OPEN_DUTY_DUTY_CAP, isAvailable } from './constraints.ts'
import { isFriSatSun } from './scoring.ts'
import type { DaySpec, DoctorSpec, SchedulingContext } from './types.ts'

/**
 * MIP model of the scheduling rules in CPLEX LP text, one text per stage.
 *
 * Each doctor's capacity (the most duties they could take on their own
 * under every per-doctor rule, with no fairness relaxation) is computed
 * exactly by `capacityOf`, without a solve. The stages are lexicographic
 * objectives, highest priority first (design levels 1-6):
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
 * The `alternative` stage is not in the solve order: it keeps every stage at
 * its optimum and finds another schedule as different as possible from the
 * earlier schedule options.
 * Names and row order are deterministic: doctors by id, dates ascending.
 */

export type Stage =
  | `cover-critical-${number}`
  | `cover-regular-${number}`
  | 'relax'
  | 'weekdays'
  | 'share'
  | 'holidays'
  | 'fill'
  | 'alternative'

/**
 * Largest weighted objective of one merged cover solve. Consecutive cover
 * stages share one solve while their weighted objective stays below this,
 * so HiGHS works with small exact integers.
 */
const COVER_WEIGHT_LIMIT = 1_000_000

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
  /** Lexicographic stage order, highest priority first. */
  stages: Stage[]
  /** Solve order: `stages` with consecutive cover stages merged into one weighted solve. */
  steps: Stage[][]
  /**
   * Objective weight of each cover stage inside its merged step: larger than
   * the largest total of every later stage of the step, so the weighted
   * optimum is the lexicographic one. Used only when a step has several stages.
   */
  weights: Map<Stage, number>
}

export interface ModelBounds {
  /** Optimum of every solved stage before the one being built. */
  optima: ReadonlyMap<Stage, number>
  /** Per-doctor capacity from `capacityOf`; required from the `share` stage on. */
  capacity: ReadonlyMap<number, number>
  /** Chosen cell names of every earlier schedule option; `alternative` stage only. */
  avoid?: readonly ReadonlySet<string>[]
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
  const cover = [true, false].flatMap((critical) => {
    const deepest = Math.max(0, ...days.filter((d) => d.critical === critical).map((d) => d.minimum))
    return Array.from({ length: deepest }, (_, i) => ({
      stage: coverStage(critical, i + 1),
      terms: days.filter((d) => d.critical === critical && d.minimum > i).length,
    }))
  })
  // Weights are built from the last stage of a step back to the first:
  // w_k = product of (terms_j + 1) over the later stages j of the step.
  const steps: Stage[][] = []
  const weights = new Map<Stage, number>()
  let group: typeof cover = []
  const close = (): void => {
    let weight = 1
    for (const { stage, terms } of [...group].reverse()) {
      weights.set(stage, weight)
      weight *= terms + 1
    }
    steps.push(group.map((g) => g.stage))
    group = []
  }
  let product = 1
  for (const c of cover) {
    if (group.length > 0 && product * (c.terms + 1) > COVER_WEIGHT_LIMIT) {
      close()
      product = 1
    }
    group.push(c)
    product *= c.terms + 1
  }
  if (group.length > 0) close()
  const rest: Stage[] = ['relax', 'weekdays', 'share', 'holidays', 'fill']
  steps.push(...rest.map((s) => [s]))
  const stages: Stage[] = [...cover.map((c) => c.stage), ...rest]
  return { doctors, days, cellsByDoctor, cellsByDate, stages, steps, weights }
}

const coverStage = (critical: boolean, p: number): Stage =>
  critical ? `cover-critical-${p}` : `cover-regular-${p}`

/** A doctor's holiday cells, split by whether the holiday cap exempts them. */
export function holidayCells(cells: readonly ModelCell[]): { nonCritical: ModelCell[]; critical: ModelCell[] } {
  return {
    nonCritical: cells.filter((c) => c.day.day.isHoliday && !c.day.critical),
    critical: cells.filter((c) => c.day.day.isHoliday && c.day.critical),
  }
}

/** Doctors with a positive capacity: the ones the fair share is computed over. */
const sharedDoctors = (index: ModelIndex, capacity: ReadonlyMap<number, number>): DoctorSpec[] =>
  index.doctors.filter((d) => (capacity.get(d.id) ?? 0) > 0)

/**
 * Each doctor's capacity: the most duties they could take on their own under
 * the monthly cap, back-to-back, open-duty, holiday and Fri/Sat/Sun rules,
 * with no relaxation. Doctors do not couple under these rules, so a dynamic
 * program over the doctor's days is exact. Every rule is downward closed
 * (dropping a duty never breaks one), so the monthly cap only clips the
 * result.
 */
export function capacityOf(index: ModelIndex): Map<number, number> {
  const capacity = new Map<number, number>()
  for (const doctor of index.doctors) {
    const cells = index.cellsByDoctor.get(doctor.id) ?? []
    // State after each cell -> most duties so far. `c` (critical holidays)
    // saturates above the cap: beyond it every count behaves the same.
    interface State { taken: boolean; open: number; n: number; c: number; mask: number }
    const key = (s: State): string => `${+s.taken}|${s.open}|${s.n}|${s.c}|${s.mask}`
    let states = new Map<string, { state: State; count: number }>([
      ['', { state: { taken: false, open: 0, n: 0, c: 0, mask: 0 }, count: 0 }],
    ])
    cells.forEach((cell, i) => {
      const adjacent = i > 0 && nextDate(cells[i - 1]!.day.day.date) === cell.day.day.date
      const next = new Map<string, { state: State; count: number }>()
      const keep = (state: State, count: number): void => {
        const k = key(state)
        if ((next.get(k)?.count ?? -1) < count) next.set(k, { state, count })
      }
      const bit = isFriSatSun(cell.day.day) ? 1 << cell.day.day.dayOfWeek : 0
      const holiday = cell.day.day.isHoliday
      for (const { state, count } of states.values()) {
        keep({ ...state, taken: false }, count)
        if (state.taken && adjacent) continue
        const open = state.open + (cell.day.open ? 1 : 0)
        const n = state.n + (holiday && !cell.day.critical ? 1 : 0)
        const c = Math.min(HOLIDAY_DUTY_CAP + 1, state.c + (holiday && cell.day.critical ? 1 : 0))
        if (open > OPEN_DUTY_DUTY_CAP || (state.mask & bit) !== 0) continue
        if (n > 0 && n + c > HOLIDAY_DUTY_CAP) continue
        keep({ taken: true, open, n, c, mask: state.mask | bit }, count + 1)
      }
      states = next
    })
    const best = Math.max(0, ...[...states.values()].map((s) => s.count))
    capacity.set(doctor.id, Math.min(doctor.maxMonthlyDuties, best))
  }
  return capacity
}

/**
 * Value of a minimized stage objective for the schedule `chosen`, with every
 * auxiliary variable at its smallest feasible value. Mirrors the rows of
 * `buildModel`; the stage must be a minimized one.
 */
export function stageValue(
  index: ModelIndex,
  stage: Stage,
  chosen: ReadonlySet<string>,
  capacity: ReadonlyMap<number, number>,
): number {
  const picked = (cells: readonly ModelCell[]): number => cells.filter((c) => chosen.has(c.name)).length
  if (stage.startsWith('cover-')) {
    const p = Number(stage.slice(stage.lastIndexOf('-') + 1))
    return index.days.filter(
      (d) =>
        d.minimum >= p && coverStage(d.critical, p) === stage && picked(index.cellsByDate.get(d.day.date) ?? []) < p,
    ).length
  }
  const cellsOf = (id: number): ModelCell[] => index.cellsByDoctor.get(id) ?? []
  switch (stage) {
    case 'relax':
      return index.doctors.reduce((sum, doctor) => {
        const cells = cellsOf(doctor.id)
        const holidays = holidayCells(cells)
        const n = picked(holidays.nonCritical)
        // ho >= n + c - cap without the exemption branch, ho >= n with it.
        const over = Math.max(0, Math.min(n + picked(holidays.critical) - HOLIDAY_DUTY_CAP, n))
        const repeats = FRI_SAT_SUN.reduce((s, w) => s + Math.max(0, picked(sameWeekday(cells, w.dayOfWeek)) - 1), 0)
        return sum + over + repeats
      }, 0)
    case 'weekdays':
      return index.doctors.reduce((sum, doctor) => {
        const missing = FRI_SAT_SUN.filter((w) => {
          const same = sameWeekday(cellsOf(doctor.id), w.dayOfWeek)
          return same.length > 0 && picked(same) === 0
        })
        return sum + missing.length
      }, 0)
    case 'share': {
      const shared = sharedDoctors(index, capacity)
      if (shared.length < 2) return 0
      const e = shared.reduce((sum, d) => sum + (capacity.get(d.id) ?? 0), 0)
      const totals = shared.map((d) => picked(cellsOf(d.id)))
      const total = totals.reduce((sum, t) => sum + t, 0)
      const worst = Math.max(...shared.map((d, i) => Math.abs(e * totals[i]! - (capacity.get(d.id) ?? 0) * total)))
      return Math.max(0, worst - (e - 1))
    }
    case 'holidays': {
      const counts = index.doctors
        .map((d) => cellsOf(d.id).filter((c) => c.day.day.isHoliday))
        .filter((cells) => cells.length > 0)
        .map(picked)
      return counts.length < 2 ? 0 : Math.max(0, Math.max(...counts) - Math.min(...counts) - 1)
    }
    default:
      throw new Error(`stage ${stage} is not minimized`)
  }
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
 * LP text for `step` (one stage, or consecutive cover stages solved as one
 * weighted objective), or null when it has nothing to optimize (for example
 * no Fri/Sat/Sun duty is possible), so the caller skips it.
 */
export function buildModel(index: ModelIndex, step: Stage | readonly Stage[], bounds: ModelBounds): string | null {
  const group = typeof step === 'string' ? [step] : step
  const stage = group[0]!
  const lp = new LpText()
  const avoid = bounds.avoid ?? []
  // The alternative keeps every stage at its optimum, so every block is built.
  const rank = stage === 'alternative' ? index.stages.length : index.stages.indexOf(stage)
  const reached = (s: Stage): boolean => index.stages.indexOf(s) <= rank
  const allCells = [...index.cellsByDoctor.values()].flat()
  if (stage === 'alternative' && (allCells.length === 0 || avoid.length === 0)) return null
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

    // Before `relax` the relaxation integers can always absorb these rows
    // (ho = n with hb = 1, rp = repeats), so they cannot bind and are left out.
    if (!reached('relax')) continue

    // Holiday cap: non-critical holiday duties n <= max(0, cap - c) + over,
    // c = critical holiday duties (exempt from the cap but counted). The
    // binary picks the c > cap branch, which allows no non-critical holiday.
    const { nonCritical, critical } = holidayCells(cells)
    if (nonCritical.length > 0 && nonCritical.length + critical.length > HOLIDAY_DUTY_CAP) {
      lp.integer(`ho_${id}`, nonCritical.length)
      const over: Term = [-1, `ho_${id}`]
      add('relax', [1, `ho_${id}`])
      if (critical.length === 0) {
        lp.row(`hol_${id}`, [...ones(nonCritical), over], '<=', HOLIDAY_DUTY_CAP)
      } else {
        const m = nonCritical.length + critical.length
        lp.binaries.push(`hb_${id}`)
        lp.row(
          `hol_${id}`,
          [...ones(nonCritical), ...ones(critical), [-m, `hb_${id}`], over],
          '<=',
          HOLIDAY_DUTY_CAP,
        )
        lp.row(`holb_${id}`, [...ones(nonCritical), [m, `hb_${id}`], over], '<=', m)
      }
    }

    // D2: at most one duty per Fri/Sat/Sun weekday unless coverage needs more.
    for (const w of FRI_SAT_SUN) {
      const same = sameWeekday(cells, w.dayOfWeek)
      if (same.length < 2) continue
      lp.integer(`rp_${id}_${w.code}`, same.length - 1)
      add('relax', [1, `rp_${id}_${w.code}`])
      lp.row(`rep_${id}_${w.code}`, [...ones(same), [-1, `rp_${id}_${w.code}`]], '<=', 1)
    }
  }

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
      add(coverStage(d.critical, p), [1, unmet])
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
    const shared = sharedDoctors(index, bounds.capacity)
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
    const holidays = index.doctors
      .map((d) => ({ id: d.id, cells: (index.cellsByDoctor.get(d.id) ?? []).filter((c) => c.day.day.isHoliday) }))
      .filter((h) => h.cells.length > 0)
    if (holidays.length >= 2) {
      for (const h of holidays) {
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

  if (stage === 'alternative') {
    // `fill` is maximized, so its bound is the only `>=` one.
    const fill = bounds.optima.get('fill')
    if (fill !== undefined) lp.row('bound_fill', ones(allCells), '>=', fill)
    // Each earlier option is excluded; the objective counts the duties shared
    // with earlier options, once per option that holds them.
    const overlap = new Map<string, number>()
    for (const [j, set] of avoid.entries()) {
      const same = allCells.filter((c) => set.has(c.name))
      // An empty option means the fill optimum is 0: no other schedule exists.
      if (same.length === 0) return null
      lp.row(`nogood_${j + 1}`, ones(same), '<=', same.length - 1)
      for (const c of same) overlap.set(c.name, (overlap.get(c.name) ?? 0) + 1)
    }
    return lp.render('Minimize', [...overlap].map(([name, n]): Term => [n, name]))
  }

  if (stage === 'fill') return allCells.length > 0 ? lp.render('Maximize', ones(allCells)) : null
  const weight = (s: Stage): number => (group.length > 1 ? (index.weights.get(s) ?? 1) : 1)
  const objective = group.flatMap((s) => (objectives.get(s) ?? []).map(([c, v]): Term => [c * weight(s), v]))
  return objective.length > 0 ? lp.render('Minimize', objective) : null
}
