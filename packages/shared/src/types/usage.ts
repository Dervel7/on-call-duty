export interface LicenseInfo {
  licensee: string
  doctorAllowance: number
  rollingWindowDays: number
  expiresAt: string | null
}

export interface GenerationEvent {
  year: number
  month: number
  generatedAt: string
  doctorIds: number[]
  doctorNames: string[]
  /** Overlap with the previous generation of the same month; null when there is no previous one. */
  overlapPercent: number | null
}

export type OperatorAlertType = 'allowance_exceeded' | 'disjoint_regeneration'

export interface OperatorAlert {
  id: number
  type: OperatorAlertType
  detail: Record<string, unknown>
  createdAt: string
  resolvedAt: string | null
}

export interface UsageSummary {
  license: LicenseInfo
  rollingDistinctDoctors: number
  openAlerts: number
}

export interface GeneratePressUserCount {
  userId: number
  username: string
  firstName: string
  lastName: string
  presses: number
}

export interface GeneratePressCounts {
  total: number
  byUser: GeneratePressUserCount[]
}
