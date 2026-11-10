export interface CalendarAssignment {
  doctorId: number
  firstName: string
  lastName: string
}

/** Groups items into per-date slot lists for DutyCalendar; `toEntry` maps an item to its date and slot. */
export function groupByDate<T>(
  items: readonly T[],
  toEntry: (item: T) => [date: string, slot: CalendarAssignment],
): Map<string, CalendarAssignment[]> {
  const byDate = new Map<string, CalendarAssignment[]>()
  for (const item of items) {
    const [date, slot] = toEntry(item)
    const slots = byDate.get(date) ?? []
    slots.push(slot)
    byDate.set(date, slots)
  }
  return byDate
}
