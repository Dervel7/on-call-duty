export function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate()
}

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

/** Monday-first weekday headers. */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** 'Month YYYY' for a 1-based month, e.g. monthLabel(2026, 10) → 'October 2026'. */
export function monthLabel(year: number | string, month: number): string {
  return `${MONTHS[month - 1]} ${year}`
}

export function toIsoMonth(year: number, month0: number): string {
  return `${year}-${String(month0 + 1).padStart(2, '0')}`
}

export function toIsoDate(date: Date): string {
  return `${toIsoMonth(date.getFullYear(), date.getMonth())}-${String(date.getDate()).padStart(2, '0')}`
}

export interface MonthGridDay {
  iso: string
  day: number
  weekend: boolean
}

/** Monday-first calendar grid of a month, padded with nulls to whole weeks. */
export function monthGrid(year: number, month0: number): (MonthGridDay | null)[] {
  const lead = (new Date(year, month0, 1).getDay() + 6) % 7
  const out: (MonthGridDay | null)[] = Array.from({ length: lead }, () => null)
  for (let day = 1; day <= daysInMonth(year, month0); day++) {
    out.push({
      iso: `${toIsoMonth(year, month0)}-${String(day).padStart(2, '0')}`,
      day,
      weekend: (lead + day - 1) % 7 >= 5,
    })
  }
  while (out.length % 7 !== 0) out.push(null)
  return out
}

/** 'YYYY-MM-DD' or a 'start → end' range when the days differ. */
export function formatRange(r: { startDate: string; endDate: string }): string {
  return r.startDate === r.endDate ? r.startDate : `${r.startDate} → ${r.endDate}`
}

/** Next calendar month as 'YYYY-MM' relative to today. */
export function nextMonthIso(): string {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return toIsoMonth(next.getFullYear(), next.getMonth())
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

/**
 * One entry per ISO day covered by the records, clipped to the optional
 * inclusive [from, to] bounds; the first record covering a day wins. Sorted.
 */
export function expandDays<R extends { startDate: string; endDate: string }>(
  records: R[],
  from?: string,
  to?: string,
): Array<{ iso: string; record: R }> {
  const byDay = new Map<string, R>()
  for (const r of records) {
    for (const iso of eachDay(r.startDate, r.endDate)) {
      if (from !== undefined && iso < from) continue
      if (to !== undefined && iso > to) continue
      if (!byDay.has(iso)) byDay.set(iso, r)
    }
  }
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([iso, record]) => ({ iso, record }))
}

/** All ISO days covered by the records, skipping the record with `exceptId`. */
export function coveredDays(
  records: Array<{ id: number; startDate: string; endDate: string }>,
  exceptId: number | null,
): string[] {
  return records.filter((r) => r.id !== exceptId).flatMap((r) => eachDay(r.startDate, r.endDate))
}
