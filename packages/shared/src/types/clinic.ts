export interface Clinic {
  id: number
  name: string
  isActive: boolean
  doctorCount: number
  adminCount: number
  createdAt: string
}

export interface CreateClinicRequest {
  name: string
}

export interface UpdateClinicRequest {
  name?: string
  isActive?: boolean
}
