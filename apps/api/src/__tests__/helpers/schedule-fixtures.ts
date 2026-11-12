export const SEEDED_MINIMUMS = { openDutyMinimum: 2, postOpenDutyMinimum: 2, closedDutyMinimum: 2 }

export function scheduleRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    year: 2026,
    month: 9,
    status: 'draft',
    clinic_id: 1,
    clinic_name: 'Radiology',
    created_by: 2,
    created_at: new Date('2026-08-01'),
    updated_at: new Date('2026-08-01'),
    ...overrides,
  }
}

export const SCOPE = { clinicId: 1 } as const

export const CLINIC_DOCTORS = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  max_monthly_duties: 7,
  first_name: `D${i + 1}`,
  last_name: `D${i + 1}`,
  is_active: true,
}))
