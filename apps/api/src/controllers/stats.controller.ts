import type { NextFunction, Request, Response } from 'express'
import type { StatsQuery } from '@oncall/shared'
import { ok } from '../lib/envelope'
import { HttpError } from '../lib/http-error'
import { resolveClinicScope } from '../lib/scope'
import { adminStats, currentYearMonthUTC, meStats } from '../services/stats.service'

export const statsController = {
  async admin(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as StatsQuery
      const now = currentYearMonthUTC()
      const year = q.year ?? now.year
      const month = q.month ?? now.month
      const scope = resolveClinicScope(req.user!, q.clinicId)
      const stats = await adminStats(year, month, scope)
      res.status(200).json(ok({ stats }))
    } catch (err) {
      next(err)
    }
  },
  async me(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      const stats = await meStats(req.user.id)
      res.status(200).json(ok({ stats }))
    } catch (err) {
      next(err)
    }
  },
}
