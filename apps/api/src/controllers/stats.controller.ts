import type { NextFunction, Request, Response } from 'express'
import type { MonthQuery } from '@oncall/shared'
import { ok } from '../lib/envelope.ts'
import { resolveClinicScope } from '../lib/scope.ts'
import { adminStats, meStats } from '../services/stats.service.ts'

export const statsController = {
  async admin(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as MonthQuery
      const scope = await resolveClinicScope(req.user!, q.clinicId)
      const stats = await adminStats(scope, q.year, q.month)
      res.status(200).json(ok({ stats }))
    } catch (err) {
      next(err)
    }
  },
  async me(req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await meStats(req.user!.id)
      res.status(200).json(ok({ stats }))
    } catch (err) {
      next(err)
    }
  },
}
