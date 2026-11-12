import type { Actor } from '@oncall/shared'

declare global {
  namespace Express {
    interface Request {
      user?: Actor
    }
  }
}
