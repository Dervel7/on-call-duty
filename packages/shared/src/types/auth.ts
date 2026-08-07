export type Role = 'administrator' | 'doctor'

export interface AuthUser {
  id: number
  email: string
  role: Role
  firstName: string
  lastName: string
}

export interface User extends AuthUser {
  isActive: boolean
  createdAt: string
}

export interface LoginRequest {
  email: string
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
export interface CreateUserRequest {
  email: string
  password: string
  role: Role
  firstName: string
  lastName: string
}
export interface UpdateUserRequest {
  email?: string
  role?: Role
  firstName?: string
  lastName?: string
  isActive?: boolean
}
