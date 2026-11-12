import type { ScheduleAlternativeResult, ScheduleOption, ScheduleOptionsResult } from '@oncall/shared'
import { HttpError } from '../lib/http-error.ts'
import type { ClinicScope } from '../lib/scope.ts'
import {
  generateAlternative as runAlternative,
  generatePrimary,
  SOLVER_BUDGET_MS,
  SolverBusyError,
  type GenerateResult,
  type PrimaryState,
  type SchedulingContext,
} from '../scheduling/index.ts'
import { assertNoSchedule } from './schedule-rows.ts'
import { buildContext, eligibilityFor } from './scheduling-context.ts'

const SCHEDULE_OPTION_COUNT = 3

const OPTIONS_CACHE_TTL_MS = 15 * 60_000
const OPTIONS_CACHE_MAX = 20

/** Server-side state that lets an alternative build on the primary option shown on screen. */
interface OptionsCacheEntry {
  ctx: SchedulingContext
  state: PrimaryState
  options: ScheduleOption[]
  /** An alternative came back empty: no other equally good schedule exists. */
  exhausted: boolean
  expiresAt: number
}

// One API process is assumed (see rate-limit.ts); a restart only costs a regenerate (404).
const optionsCache = new Map<string, OptionsCacheEntry>()

function optionsKey(year: number, month: number, clinicId: number): string {
  return `${clinicId}:${year}-${month}`
}

function storeOptions(key: string, entry: OptionsCacheEntry): void {
  const now = Date.now()
  for (const [k, v] of optionsCache) if (v.expiresAt <= now) optionsCache.delete(k)
  optionsCache.delete(key)
  // Map keeps insertion order, so the first key is the oldest entry.
  while (optionsCache.size >= OPTIONS_CACHE_MAX) optionsCache.delete(optionsCache.keys().next().value!)
  optionsCache.set(key, entry)
}

function readOptions(key: string): OptionsCacheEntry {
  const entry = optionsCache.get(key)
  if (!entry || entry.expiresAt <= Date.now()) {
    optionsCache.delete(key)
    throw new HttpError(404, 'Options expired, generate them again')
  }
  return entry
}

/** A busy solver holds the slot for at most its budget; tell callers to retry after that. */
const SOLVER_BUSY_RETRY_SECONDS = Math.ceil(SOLVER_BUDGET_MS / 1000)

/** Maps the solver slot rejection to 429 so callers can retry later. */
async function mapSolverBusy<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof SolverBusyError)
      throw new HttpError(429, 'Solver busy, try again shortly', SOLVER_BUSY_RETRY_SECONDS)
    throw err
  }
}

function doctorSetsByDate(assignments: { date: string; doctorId: number }[]): Map<string, Set<number>> {
  const byDate = new Map<string, Set<number>>()
  for (const a of assignments) {
    const set = byDate.get(a.date) ?? new Set<number>()
    set.add(a.doctorId)
    byDate.set(a.date, set)
  }
  return byDate
}

function changedDatesOf(
  ctx: SchedulingContext,
  base: Map<string, Set<number>>,
  option: Map<string, Set<number>>,
): string[] {
  return ctx.days
    .map((d) => d.date)
    .filter((date) => {
      const a = base.get(date) ?? new Set<number>()
      const b = option.get(date) ?? new Set<number>()
      return a.size !== b.size || [...a].some((id) => !b.has(id))
    })
}

function toOption(entry: OptionsCacheEntry, index: number, result: GenerateResult): ScheduleOption {
  const base = doctorSetsByDate(entry.options[0]?.assignments ?? result.assignments)
  return {
    index,
    assignments: result.assignments,
    conflicts: result.conflicts,
    days: eligibilityFor(entry.ctx, result.assignments),
    changedDates: index === 1 ? [] : changedDatesOf(entry.ctx, base, doctorSetsByDate(result.assignments)),
  }
}

/**
 * Option 1 only; the alternatives are solved on demand by generateAlternative.
 * Read-only like preview: no activity log entry and no usage metering.
 */
export async function generateOptions(
  year: number,
  month: number,
  scope: ClinicScope,
): Promise<ScheduleOptionsResult> {
  await assertNoSchedule(year, month, scope.clinicId)
  const ctx = await buildContext(year, month, scope.clinicId)
  const { result, state } = await mapSolverBusy(() => generatePrimary(ctx))
  const entry: OptionsCacheEntry = {
    ctx,
    state,
    options: [],
    exhausted: false,
    expiresAt: Date.now() + OPTIONS_CACHE_TTL_MS,
  }
  entry.options.push(toOption(entry, 1, result))
  storeOptions(optionsKey(year, month, scope.clinicId), entry)
  return { year, month, options: entry.options, maxOptions: SCHEDULE_OPTION_COUNT, moreAvailable: state.optimal }
}

/** Option `index` (2 or 3), built on the cached primary; options come strictly in order. */
export async function generateAlternative(
  year: number,
  month: number,
  index: number,
  scope: ClinicScope,
): Promise<ScheduleAlternativeResult> {
  await assertNoSchedule(year, month, scope.clinicId)
  const entry = readOptions(optionsKey(year, month, scope.clinicId))
  const moreAvailable = (): boolean =>
    entry.state.optimal && !entry.exhausted && entry.options.length < SCHEDULE_OPTION_COUNT
  const cached = entry.options[index - 1]
  if (cached) return { option: cached, moreAvailable: moreAvailable() }
  if (entry.exhausted) return { option: null, moreAvailable: false }
  if (index > entry.options.length + 1)
    throw new HttpError(400, 'Generate the previous option first')
  const next = await mapSolverBusy(() => runAlternative(entry.ctx, entry.state))
  if (!next) {
    entry.exhausted = true
    return { option: null, moreAvailable: false }
  }
  const option = toOption(entry, index, next.result)
  entry.options.push(option)
  return { option, moreAvailable: moreAvailable() }
}
