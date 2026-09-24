export function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate()
}

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Next calendar month as 'YYYY-MM' relative to today. */
export function nextMonthIso(): string {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
}

/** Inclusive ISO bounds of an 'YYYY-MM' month; empty when no month is given. */
export function monthRange(month: string): { from?: string; to?: string } {
  if (!/^\d{4}-\d{2}$/.test(month)) return {}
  const year = Number(month.slice(0, 4))
  const month0 = Number(month.slice(5, 7)) - 1
  return {
    from: `${month}-01`,
    to: `${month}-${String(daysInMonth(year, month0)).padStart(2, '0')}`,
  }
}

function nextDayIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return toIsoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1))
}

/** Expands an inclusive 'YYYY-MM-DD' range into the list of ISO days it covers. */
export function eachDay(startIso: string, endIso: string): string[] {
  const out: string[] = []
  for (let iso = startIso; iso <= endIso; iso = nextDayIso(iso)) out.push(iso)
  return out
}

/** Groups ISO days (any order, duplicates ignored) into consecutive ranges. */
export function groupConsecutiveDays(
  days: string[],
): Array<{ startDate: string; endDate: string }> {
  const out: Array<{ startDate: string; endDate: string }> = []
  for (const iso of [...new Set(days)].sort()) {
    const last = out[out.length - 1]
    if (last && nextDayIso(last.endDate) === iso) last.endDate = iso
    else out.push({ startDate: iso, endDate: iso })
  }
  return out
}
