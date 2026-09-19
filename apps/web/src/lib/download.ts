export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Clinic-aware CSV filename: `oncall-{slug(clinic)}-{year}-{month}.csv`.
 * Falls back to `oncall-{year}-{month}.csv` when no clinic name exists.
 */
export function csvFilename(year: number, month: number, clinicName?: string | null): string {
  const monthPart = String(month).padStart(2, '0')
  const clinic = clinicName
    ? clinicName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    : ''
  return clinic ? `oncall-${clinic}-${year}-${monthPart}.csv` : `oncall-${year}-${monthPart}.csv`
}
