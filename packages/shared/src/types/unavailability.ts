export interface Unavailability {
  id: number
  doctorId: number
  doctorFirstName: string
  doctorLastName: string
  startDate: string
  endDate: string
  createdAt: string
  updatedAt: string
}

export interface CreateUnavailabilityAdminRequest {
  doctorId: number
  startDate: string
  endDate: string
}

export interface CreateUnavailabilitySelfRequest {
  startDate: string
  endDate: string
}

export interface UpdateUnavailabilityRequest {
  startDate?: string
  endDate?: string
}

export interface UnavailabilityQuery {
  doctorId?: number
  from?: string
  to?: string
  clinicId?: number
}
