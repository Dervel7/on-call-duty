import type { LegacyHighsSolution } from 'highs'
import { logger } from '../logger.ts'
import { blockingRule, emptyTally, type DutyCounts } from './conflicts.ts'
import { HOLIDAY_DUTY_CAP } from './constraints.ts'
import { generateGreedy } from './engine.ts'
import { loadSolver, type Solver, type SolverLoader } from './highs.ts'
import {
  FRI_SAT_SUN,
  buildModel,
  indexModel,
  sameWeekday,
  type ModelBounds,
  type ModelCell,
  type ModelIndex,
  type Stage,
} from './solver-model.ts'
import type { AssignmentPlan, ConflictPlan, GenerateResult, SchedulingContext } from './types.ts'

/** Wall-clock budget for all solves of one generate() call (D4). */
export const SOLVER_BUDGET_MS = 45_000

/** Wall-clock budget of each alternative schedule option, on top of the primary solve. */
export const ALTERNATIVE_BUDGET_MS = 5_000

/** Fixed options so the same input always gives the same schedule (D5). */
const SOLVE_OPTIONS = { output_flag: false, threads: 1, random_seed: 0, mip_rel_gap: 0 } as const

type SolverStatus = 'optimal' | 'time limit'

interface Solution {
  /** Names of the assigned cells. */
  chosen: Set<string>
  status: SolverStatus
}

interface StagesResult {
  /** The last solution found, or null when none was found within the budget. */
  solution: Solution | null
  /** Optimum of every stage solved to optimality, `fill` included. */
  optima: Map<Stage, number>
  capacity: Map<number, number>
}

/** Raised when another solver run holds the single slot; callers never queue. */
export class SolverBusyError extends Error {
  constructor() {
    super('Solver busy')
    this.name = 'SolverBusyError'
  }
}

let busy = false

/** The one gate: every public entry point wraps its private worker in this once. */
async function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (busy) throw new SolverBusyError()
  busy = true
  try {
    return await fn()
  } finally {
    busy = false
  }
}

/** What an alternative option needs from the primary solve. */
export interface PrimaryState {
  optima: Map<Stage, number>
  capacity: Map<number, number>
  /** Chosen cells of every option so far, primary first. */
  chosen: Set<string>[]
  /** True when the primary is proven optimal, so equally good alternatives exist. */
  optimal: boolean
}

/**
 * Exact scheduling engine: solves the lexicographic MIP stages of
 * `solver-model.ts` with HiGHS. On a solver error, or when no feasible
 * schedule is found within the budget, the greedy engine runs instead and
 * every reason ends with `; fallback`.
 */
export async function generate(
  ctx: SchedulingContext,
  loader: SolverLoader = loadSolver,
): Promise<GenerateResult> {
  return (await generatePrimary(ctx, loader)).result
}

/**
 * The primary option plus the state needed to derive alternatives from it.
 * Alternatives exist only when the primary is proven optimal.
 */
export function generatePrimary(
  ctx: SchedulingContext,
  loader: SolverLoader = loadSolver,
): Promise<{ result: GenerateResult; state: PrimaryState }> {
  return runExclusive(() => solvePrimary(ctx, loader))
}

/**
 * The next alternative schedule: every stage stays at its optimum (equally
 * good) and it differs as much as possible from the earlier options. Null
 * when no other equally good schedule exists (Infeasible), none was found in
 * time, or the solve failed; the earlier options stay valid.
 */
export function generateAlternative(
  ctx: SchedulingContext,
  state: PrimaryState,
  loader: SolverLoader = loadSolver,
): Promise<{ result: GenerateResult } | null> {
  return runExclusive(() => solveNext(ctx, state, loader))
}

async function solvePrimary(
  ctx: SchedulingContext,
  loader: SolverLoader,
): Promise<{ result: GenerateResult; state: PrimaryState }> {
  const deadline = Date.now() + SOLVER_BUDGET_MS
  const index = indexModel(ctx)
  let failure: unknown = 'no feasible schedule within the time budget'
  try {
    const solver = await loader()
    const { solution, optima, capacity } = await solveStages(solver, index, deadline)
    if (solution) {
      return {
        result: decode(ctx, index, solution),
        state: { optima, capacity, chosen: [solution.chosen], optimal: solution.status === 'optimal' },
      }
    }
  } catch (err) {
    failure = err
  }
  logger.warn(
    { clinicId: ctx.clinicId, year: ctx.year, month: ctx.month, err: failure },
    'scheduling solver failed; greedy fallback used',
  )
  const greedy = generateGreedy(ctx)
  return {
    result: {
      assignments: greedy.assignments.map((a) => ({ ...a, reason: `${a.reason}; fallback` })),
      conflicts: greedy.conflicts,
    },
    state: { optima: new Map(), capacity: new Map(), chosen: [], optimal: false },
  }
}

async function solveNext(
  ctx: SchedulingContext,
  state: PrimaryState,
  loader: SolverLoader,
): Promise<{ result: GenerateResult } | null> {
  // Without proven optima there are no bounds to keep the alternatives equally good.
  if (!state.optimal) return null
  const index = indexModel(ctx)
  let chosen: Set<string> | null
  try {
    chosen = await solveAlternative(ctx, await loader(), index, {
      optima: state.optima,
      capacity: state.capacity,
      avoid: state.chosen,
    })
  } catch (err) {
    logSolveFailure(ctx, state.chosen.length + 1, err)
    return null
  }
  if (!chosen) return null
  state.chosen.push(chosen)
  return { result: decode(ctx, index, { chosen, status: 'optimal' }) }
}

function logSolveFailure(ctx: SchedulingContext, option: number, err: unknown): void {
  logger.warn(
    { clinicId: ctx.clinicId, year: ctx.year, month: ctx.month, option, err },
    'schedule option solve failed; fewer options returned',
  )
}

async function solveAlternative(
  ctx: SchedulingContext,
  solver: Solver,
  index: ModelIndex,
  bounds: ModelBounds,
): Promise<Set<string> | null> {
  const lp = buildModel(index, 'alternative', bounds)
  if (!lp) return null
  try {
    const result = await solver.solve(lp, SOLVE_OPTIONS, Date.now() + ALTERNATIVE_BUDGET_MS)
    if (!result || result.Status === 'Infeasible') return null
    // An incumbent at the time limit already meets every bound row.
    if (result.Status === 'Optimal' || result.Status === 'Time limit reached')
      return Number.isFinite(result.ObjectiveValue) ? chosenCells(index, result.Columns) : null
    throw new Error(`HiGHS returned "${result.Status}" at stage alternative`)
  } catch (err) {
    logSolveFailure(ctx, (bounds.avoid?.length ?? 0) + 1, err)
    return null
  }
}

/**
 * Solves the capacity stage, then every objective stage in order, and keeps
 * the last solution found. A stage that stops at the time limit ends the
 * chain with the best solution so far.
 */
async function solveStages(solver: Solver, index: ModelIndex, deadline: number): Promise<StagesResult> {
  const capacity = new Map<number, number>()
  const optima = new Map<Stage, number>()
  const result = (solution: Solution | null): StagesResult => ({ solution, optima, capacity })
  let chosen: Set<string> | null = null
  let solvedAny = false
  for (const stage of index.stages) {
    const lp = buildModel(index, stage, { optima, capacity })
    if (!lp) continue
    const solved = await solveOnce(solver, lp, deadline, stage)
    if (stage === 'capacity') {
      if (solved?.Status !== 'Optimal') return result(null)
      const best = chosenCells(index, solved.Columns)
      for (const [id, cells] of index.cellsByDoctor)
        capacity.set(id, cells.filter((c) => best.has(c.name)).length)
      continue
    }
    solvedAny = true
    if (solved?.Status === 'Optimal') {
      chosen = chosenCells(index, solved.Columns)
      // Every stage objective is integral, so the rounded bound is exact.
      optima.set(stage, Math.round(solved.ObjectiveValue))
      continue
    }
    // A finite objective at the time limit means HiGHS holds an incumbent.
    if (solved && Number.isFinite(solved.ObjectiveValue))
      chosen = chosenCells(index, solved.Columns)
    return result(chosen ? { chosen, status: 'time limit' } : null)
  }
  // No stage had anything to optimize: no possible duty and no minimum.
  if (!solvedAny) return result({ chosen: new Set(), status: 'optimal' })
  return result(chosen ? { chosen, status: 'optimal' } : null)
}

/**
 * One HiGHS solve with the remaining budget. Returns null when the budget is
 * already spent, the result when it is optimal or stopped at the time limit,
 * and throws on any other status.
 */
async function solveOnce(
  solver: Solver,
  lp: string,
  deadline: number,
  stage: Stage,
): Promise<LegacyHighsSolution | null> {
  const result = await solver.solve(lp, SOLVE_OPTIONS, deadline)
  if (!result || result.Status === 'Optimal' || result.Status === 'Time limit reached') return result
  throw new Error(`HiGHS returned "${result.Status}" at stage ${stage}`)
}

function chosenCells(index: ModelIndex, columns: LegacyHighsSolution['Columns']): Set<string> {
  const chosen = new Set<string>()
  for (const cells of index.cellsByDoctor.values()) {
    for (const cell of cells) {
      const column = columns[cell.name]
      if (column && 'Primal' in column && column.Primal > 0.5) chosen.add(cell.name)
    }
  }
  return chosen
}

/** Assignments with explainable reasons, plus a conflict for every short day. */
function decode(ctx: SchedulingContext, index: ModelIndex, solution: Solution): GenerateResult {
  const counts: DutyCounts = { byDate: new Map(), total: new Map(), openDays: new Map(), holiday: new Map() }
  const bump = (map: Map<number, number>, id: number): void => {
    map.set(id, (map.get(id) ?? 0) + 1)
  }
  for (const d of index.days) {
    const ids = new Set<number>()
    for (const cell of index.cellsByDate.get(d.day.date) ?? []) {
      if (!solution.chosen.has(cell.name)) continue
      ids.add(cell.doctorId)
      bump(counts.total, cell.doctorId)
      if (d.open) bump(counts.openDays, cell.doctorId)
      if (d.day.isHoliday) bump(counts.holiday, cell.doctorId)
    }
    counts.byDate.set(d.day.date, ids)
  }
  // A duty on a day at (or below) its minimum is one that coverage needed.
  const needed = (cell: ModelCell): boolean =>
    (counts.byDate.get(cell.day.day.date)?.size ?? 0) <= cell.day.minimum

  const notes = new Map<string, string[]>()
  const note = (cell: ModelCell, text: string): void => {
    notes.set(cell.name, [...(notes.get(cell.name) ?? []), text])
  }
  for (const doctor of index.doctors) {
    const cells = (index.cellsByDoctor.get(doctor.id) ?? []).filter((c) => solution.chosen.has(c.name))
    const repeats: ModelCell[] = []
    for (const w of FRI_SAT_SUN) {
      const same = sameWeekday(cells, w.dayOfWeek)
      if (same.length === 1) note(same[0]!, `first ${w.name}`)
      // Only the extra duties are repeats: the chronologically last ones.
      if (same.length > 1) repeats.push(...same.filter(needed).slice(1 - same.length))
    }
    const nonCritical = cells.filter((c) => c.day.day.isHoliday && !c.day.critical)
    const critical = cells.filter((c) => c.day.day.isHoliday && c.day.critical)
    const excess = nonCritical.length - Math.max(0, HOLIDAY_DUTY_CAP - critical.length)
    if (excess > 0) {
      for (const c of nonCritical.filter(needed).slice(-excess))
        note(c, 'day-fill guarantee overrode fairness caps')
    }
    for (const c of repeats) note(c, 'repeat weekday to reach minimum')
  }

  const doctors = new Map(ctx.doctors.map((d) => [d.id, d]))
  const assignments: AssignmentPlan[] = []
  const conflicts: ConflictPlan[] = []
  for (const d of index.days) {
    for (const cell of index.cellsByDate.get(d.day.date) ?? []) {
      if (!solution.chosen.has(cell.name)) continue
      const doctor = doctors.get(cell.doctorId)
      assignments.push({
        date: d.day.date,
        doctorId: cell.doctorId,
        doctorFirstName: doctor?.firstName ?? '',
        doctorLastName: doctor?.lastName ?? '',
        isWeekend: d.day.isWeekend,
        reason: [`solver ${solution.status}`, ...(notes.get(cell.name) ?? [])].join('; '),
      })
    }
    const assigned = counts.byDate.get(d.day.date)?.size ?? 0
    if (assigned >= d.minimum) continue
    // Same evidence as the greedy engine: a short regular day is reported
    // after the fairness caps were relaxed, and critical days skip them.
    const tally = emptyTally()
    for (const doctor of ctx.doctors) {
      const blocked = blockingRule(ctx, counts, doctor, d.day, d.critical, true)
      if (blocked) tally[blocked]++
    }
    conflicts.push({
      date: d.day.date,
      critical: d.critical,
      required: d.minimum,
      assigned,
      activeDoctors: ctx.doctors.length,
      tally,
    })
  }
  return { assignments, conflicts }
}
