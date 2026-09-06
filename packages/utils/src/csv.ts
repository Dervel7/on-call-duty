export interface CsvDutyRow {
  dutyDate: string
  doctorFirstName: string
  doctorLastName: string
  isWeekend: boolean
  reason: string
}

/** Escape one CSV field per RFC 4180: quote if it contains comma, quote, CR, or LF; double internal quotes. */
export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

const CSV_HEADERS = ['Date', 'Weekday', 'Doctor', 'Weekend', 'Reason']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Serialize roster rows to CSV (RFC 4180; CRLF line endings). The header row is always present. */
export function dutiesToCsv(rows: CsvDutyRow[]): string {
  const lines = [CSV_HEADERS.join(',')]
  for (const r of rows) {
    const d = new Date(`${r.dutyDate}T00:00:00Z`)
    const fields = [
      r.dutyDate,
      WEEKDAYS[d.getUTCDay()] ?? '',
      `${r.doctorFirstName} ${r.doctorLastName}`,
      r.isWeekend ? 'Yes' : 'No',
      r.reason,
    ].map(escapeCsvField)
    lines.push(fields.join(','))
  }
  return lines.join('\r\n')
}
