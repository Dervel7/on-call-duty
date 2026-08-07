import type { Role } from '@oncall/shared'

declare global {
  namespace Express {
    interface Request {
      user?: { id: number; role: Role }
    }
  }
}
