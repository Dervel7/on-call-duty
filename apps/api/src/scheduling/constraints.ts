export interface ConstraintResult {
  ok: boolean
  reason: string
}

/** On-call doctors assigned per day. */
export const DOCTORS_PER_DAY = 2

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

/**
 * Upper bound for ±1 balancing of `slots` duties across `doctors` eligible
 * doctors: nobody takes more than one duty above an even split. Example: 10
 * Saturday slots over 8 doctors → cap 2 (fair share 1.25), so the load can
 * spread 2/1/1/… instead of being unfillable under a fixed ≤1 cap.
 */
export function balanceCap(slots: number, doctors: number): number {
  if (doctors <= 0) return 0
  return Math.floor(slots / doctors) + 1
}
