export type Role = 'administrator' | 'doctor' | 'superadmin'

export interface AuthUser {
  id: number
  email: string
  username: string
  role: Role
  firstName: string
  lastName: string
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
export interface CreateUserRequest {
  email: string
  username: string
  password: string
  role: Role
  firstName: string
  lastName: string
}
export interface UpdateUserRequest {
  email?: string
  username?: string
  role?: Role
  firstName?: string
  lastName?: string
  isActive?: boolean
}
