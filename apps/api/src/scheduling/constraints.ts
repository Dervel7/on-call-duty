export interface ConstraintResult {
  ok: boolean
  reason: string
}

export function isAvailable(
  _doctorId: number,
  date: string,
  ranges: Array<{ start: string; end: string }> | undefined,
): ConstraintResult {
  if (!ranges || ranges.length === 0) return { ok: true, reason: '' }
  for (const r of ranges) {
    if (r.start <= date && date <= r.end) return { ok: false, reason: 'unavailable' }
  }
  return { ok: true, reason: '' }
}

export function underCap(count: number, maxMonthlyDuties: number): ConstraintResult {
  return count < maxMonthlyDuties
    ? { ok: true, reason: '' }
    : { ok: false, reason: 'at cap' }
}

export function notConsecutive(onDutyYesterday: boolean): ConstraintResult {
  return onDutyYesterday ? { ok: false, reason: 'back-to-back' } : { ok: true, reason: '' }
}
