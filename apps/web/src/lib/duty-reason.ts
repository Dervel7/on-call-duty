// The "first fri/sat/sun" term is optional: reasons stored before the engine
// added it lack it.
const ENGINE_REASON =
  /^score \d+ \(workload \+(\d+), weekend \+(\d+), friday \+(\d+)(?:, first fri\/sat\/sun \+(\d+))?\)(?:; tie-break: (fewer duties|fewer weekend duties|lower id))?(; day-fill guarantee overrode fairness caps)?$/

/** Locale message keys for the engine's tie-break codes. */
const TIE_BREAK: Record<string, string> = {
  'fewer duties': 'dutyReason.tieBreakFewerDuties',
  'fewer weekend duties': 'dutyReason.tieBreakFewerWeekendDuties',
  'lower id': 'dutyReason.tieBreakRosterOrder',
}

/** The `t` function from `useI18n()`. */
type Translate = (key: string) => string

/**
 * Turns the scheduling engine's stored duty reason (e.g.
 * "score 47 (workload +24, weekend +8, friday +0, first fri/sat/sun +5); tie-break: fewer duties")
 * into a plain-language explanation for report readers, in the active UI
 * language. Unrecognised reasons (manual overrides, custom plan notes) are
 * returned unchanged.
 */
export function explainDutyReason(reason: string, t: Translate): string {
  if (reason === 'plan') return t('dutyReason.plan')
  if (/^manual override/i.test(reason)) return t('dutyReason.manualOverride')
  const m = ENGINE_REASON.exec(reason)
  if (!m) return reason
  const [, workload, weekend, friday, friSatSun, tieBreak, relaxed] = m
  const tieBreakKey = tieBreak ? TIE_BREAK[tieBreak] : undefined
  const main =
    Number(weekend) > Number(workload)
      ? t('dutyReason.weekendBalance')
      : Number(friday) > Number(workload)
        ? t('dutyReason.fridayBalance')
        : Number(friSatSun ?? 0) > Number(workload)
          ? t('dutyReason.firstFriSatSun')
          : t('dutyReason.workload')
  return [
    main,
    tieBreakKey ? t(tieBreakKey) : '',
    relaxed ? t('dutyReason.dayFillGuarantee') : '',
  ]
    .filter(Boolean)
    .join('; ')
}
