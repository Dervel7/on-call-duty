import type { NextFunction, Request, Response } from 'express'
import type { ReportQuery } from '@oncall/shared'
import { ok } from '../lib/envelope.ts'
import { resolveClinicScope } from '../lib/scope.ts'
import { monthlyReport } from '../services/reports.service.ts'
import { currentYearMonthUTC } from '../services/stats.service.ts'

export const reportsController = {
  async monthly(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as ReportQuery
      const now = currentYearMonthUTC()
      const year = q.year ?? now.year
      const month = q.month ?? now.month
      const scope = await resolveClinicScope(req.user!, q.clinicId)
      const report = await monthlyReport(year, month, req.user!, scope)
      res.status(200).json(ok({ report }))
    } catch (err) {
      next(err)
    }
  },
}
