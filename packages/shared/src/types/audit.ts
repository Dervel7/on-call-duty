import type { Role } from './auth.ts'
import type { ActivityAction } from '../schemas/audit.ts'

export interface ActivityActor {
  id: number
  username: string
  role: Role
  firstName: string
  lastName: string
}

export interface ActivityLogEntry {
  id: number
  action: ActivityAction
  entityType: string
  entityId: number | null
  detail: Record<string, unknown>
  createdAt: string
  actor: ActivityActor | null
}

export interface ActivityQuery {
  action?: ActivityAction
  userId?: number
  clinicId?: number
  from?: string
  to?: string
  page?: number
  limit?: number
}

export interface PaginatedActivity {
  items: ActivityLogEntry[]
  total: number
  page: number
  limit: number
}
