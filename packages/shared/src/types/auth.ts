export type Role = 'superadmin' | 'manager' | 'administrator' | 'doctor'

export interface AuthUser {
  id: number
  email: string
  username: string
  role: Role
  firstName: string
  lastName: string
  darkMode: boolean
  /** Clinic the user belongs to; null for manager/superadmin (hospital/vendor level). */
  clinicId: number | null
  clinicName: string | null
}

export interface User extends AuthUser {
  isActive: boolean
  createdAt: string
}

export interface LoginRequest {
  identifier: string
  password: string
}
export interface LoginResponse {
  user: AuthUser
  accessToken: string
}
export interface RefreshResponse {
  user: AuthUser
  accessToken: string
}
export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
}
export interface ResetUserPasswordRequest {
  newPassword: string
}
export interface CreateUserRequest {
  email: string
  username: string
  password: string
  role: Role
  firstName: string
  lastName: string
  /** Target clinic of the new account (required for manager-created administrators). */
  clinicId?: number
}
export interface UpdateUserRequest {
  email?: string
  username?: string
  role?: Role
  firstName?: string
  lastName?: string
  isActive?: boolean
  /** Clinic reassignment; superadmin (any account) or manager (administrator accounts). */
  clinicId?: number
}
export interface UpdateThemeRequest {
  darkMode: boolean
}
