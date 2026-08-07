export interface Doctor {
  id: number
  userId: number
  email: string
  username: string
  firstName: string
  lastName: string
  isActive: boolean
  maxMonthlyDuties: number
  createdAt: string
  updatedAt: string
}

export interface CreateDoctorRequest {
  email: string
  username: string
  password: string
  firstName: string
  lastName: string
  maxMonthlyDuties?: number
}

export interface UpdateDoctorRequest {
  email?: string
  username?: string
  firstName?: string
  lastName?: string
  maxMonthlyDuties?: number
  isActive?: boolean
}
