export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function isWeekendISO(date: string): boolean {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay()
  return d === 0 || d === 6
}

export function prevDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function inMonth(date: string, year: number, month: number): boolean {
  return date.startsWith(`${year}-${pad2(month)}-`)
}

export function dayOfWeekISO(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

/**
 * Open on-call classification: the anchor is the first open on-call day and
 * every intervalDays-th day after it is open too. Days before the anchor are
 * always closed — the cycle starts there.
 */
export function isOpenDutyDate(date: string, anchorDate: string, intervalDays: number): boolean {
  if (date < anchorDate) return false
  const ms =
    new Date(`${date}T00:00:00Z`).getTime() - new Date(`${anchorDate}T00:00:00Z`).getTime()
  return Math.round(ms / 86_400_000) % intervalDays === 0
}
