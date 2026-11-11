import type { NextFunction, Request, Response } from 'express'
import type { MonthQuery } from '@oncall/shared'
import { ok } from '../lib/envelope.ts'
import { resolveClinicScope } from '../lib/scope.ts'
import { monthlyReport } from '../services/reports.service.ts'

export const reportsController = {
  async monthly(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as MonthQuery
      const scope = await resolveClinicScope(req.user!, q.clinicId)
      const report = await monthlyReport(scope, q.year, q.month)
      res.status(200).json(ok({ report }))
    } catch (err) {
      next(err)
    }
  },
}
