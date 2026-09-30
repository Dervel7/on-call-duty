const ENGINE_REASON =
  /^score \d+ \(workload \+(\d+), weekend \+(\d+), friday \+(\d+)\)(?:; tie-break: (fewer duties|fewer weekend duties|lower id))?(; day-fill guarantee overrode fairness caps)?$/

const TIE_BREAK: Record<string, string> = {
  'fewer duties': 'tie-break: fewer duties so far',
  'fewer weekend duties': 'tie-break: fewer weekend duties',
  'lower id': 'tie-break: roster order',
}

/**
 * Turns the scheduling engine's stored duty reason (e.g.
 * "score 42 (workload +24, weekend +8, friday +0); tie-break: fewer duties")
 * into a plain-language explanation for report readers. Unrecognised reasons
 * (manual overrides, custom plan notes) are returned unchanged.
 */
export function explainDutyReason(reason: string): string {
  if (reason === 'plan') return 'Assigned manually'
  if (/^manual override/i.test(reason)) return 'Assigned manually by an administrator'
  const m = ENGINE_REASON.exec(reason)
  if (!m) return reason
  const [, workload, weekend, friday, tieBreak, relaxed] = m
  const main =
    Number(weekend) > Number(workload)
      ? 'Picked to balance weekends — furthest behind on their fair share of weekend duties'
      : Number(friday) > Number(workload)
        ? 'Picked to balance Fridays — furthest behind on their fair share of Friday duties'
        : 'Picked for fair workload — most room left under their monthly duty limit'
  return [
    main,
    tieBreak ? TIE_BREAK[tieBreak] : '',
    relaxed ? 'assigned to guarantee the day was covered, usual fairness caps were relaxed' : '',
  ]
    .filter(Boolean)
    .join('; ')
}
