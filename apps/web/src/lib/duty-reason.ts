// The "first fri/sat/sun" term is absent from reasons stored before it was added.
const ENGINE_REASON =
  /^score \d+ \(workload \+(\d+), weekend \+(\d+), friday \+(\d+)(?:, first fri\/sat\/sun \+\d+)?\)(?:; tie-break: (fewer duties|fewer weekend duties|lower id))?(; day-fill guarantee overrode fairness caps)?(; fallback)?$/

/** Locale message keys for the engine's tie-break codes. */
const TIE_BREAK: Record<string, string> = {
  'fewer duties': 'dutyReason.tieBreakFewerDuties',
  'fewer weekend duties': 'dutyReason.tieBreakFewerWeekendDuties',
  'lower id': 'dutyReason.tieBreakRosterOrder',
}

/** Locale message keys for the exact solver's status codes. */
const SOLVER_STATUS: Record<string, string> = {
  'solver optimal': 'dutyReason.solverOptimal',
  'solver time limit': 'dutyReason.solverTimeLimit',
}

/** Locale message keys for the exact solver's notes. */
const SOLVER_NOTE: Record<string, string> = {
  'first friday': 'dutyReason.solverFirstFriday',
  'first saturday': 'dutyReason.solverFirstSaturday',
  'first sunday': 'dutyReason.solverFirstSunday',
  'day-fill guarantee overrode fairness caps': 'dutyReason.dayFillGuarantee',
  'repeat weekday to reach minimum': 'dutyReason.solverRepeatWeekday',
}

/** The `t` function from `useI18n()`. */
type Translate = (key: string) => string

/**
 * Turns a stored duty reason from the exact solver (e.g.
 * "solver optimal; first saturday") or the greedy engine (e.g.
 * "score 42 (workload +24, weekend +8, friday +0); tie-break: fewer duties")
 * into a plain-language explanation for report readers, in the active UI
 * language. Unrecognised reasons (manual overrides, custom plan notes) are
 * returned unchanged.
 */
export function explainDutyReason(reason: string, t: Translate): string {
  if (reason === 'plan') return t('dutyReason.plan')
  if (/^manual override/i.test(reason)) return t('dutyReason.manualOverride')
  return explainSolverReason(reason, t) ?? explainEngineReason(reason, t) ?? reason
}

function explainSolverReason(reason: string, t: Translate): string | null {
  const [status = '', ...notes] = reason.split('; ')
  const statusKey = SOLVER_STATUS[status]
  if (!statusKey) return null
  const parts = [t(statusKey)]
  for (const note of notes) {
    const noteKey = SOLVER_NOTE[note]
    if (!noteKey) return null
    parts.push(t(noteKey))
  }
  return parts.join('; ')
}

function explainEngineReason(reason: string, t: Translate): string | null {
  const m = ENGINE_REASON.exec(reason)
  if (!m) return null
  const [, workload, weekend, friday, tieBreak, relaxed, fallback] = m
  const tieBreakKey = tieBreak ? TIE_BREAK[tieBreak] : undefined
  const main =
    Number(weekend) > Number(workload)
      ? t('dutyReason.weekendBalance')
      : Number(friday) > Number(workload)
        ? t('dutyReason.fridayBalance')
        : t('dutyReason.workload')
  return [
    main,
    tieBreakKey ? t(tieBreakKey) : '',
    relaxed ? t('dutyReason.dayFillGuarantee') : '',
    fallback ? t('dutyReason.fallback') : '',
  ]
    .filter(Boolean)
    .join('; ')
}
