export type UnavailabilityType = 'vacation' | 'sick' | 'conference' | 'other'

export interface Unavailability {
  id: number
  doctorId: number
  doctorFirstName: string
  doctorLastName: string
  type: UnavailabilityType
  startDate: string
  endDate: string
  note: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateUnavailabilityAdminRequest {
  doctorId: number
  type: UnavailabilityType
  startDate: string
  endDate: string
  note?: string
}

export interface CreateUnavailabilitySelfRequest {
  type: UnavailabilityType
  startDate: string
  endDate: string
  note?: string
}

export interface UpdateUnavailabilityRequest {
  type?: UnavailabilityType
  startDate?: string
  endDate?: string
  note?: string | null
}

export interface UnavailabilityQuery {
  doctorId?: number
  from?: string
  to?: string
}
