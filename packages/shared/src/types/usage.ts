export interface GenerationEvent {
  year: number
  month: number
  generatedAt: string
  doctorIds: number[]
  doctorNames: string[]
  /** Overlap with the previous generation of the same month; null when there is no previous one. */
  overlapPercent: number | null
}

export type OperatorAlertType = 'disjoint_regeneration'

export interface OperatorAlert {
  id: number
  type: OperatorAlertType
  detail: Record<string, unknown>
  createdAt: string
  resolvedAt: string | null
}
