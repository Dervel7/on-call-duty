import type { NextFunction, Request, Response } from 'express'
import type { ReportQuery } from '@oncall/shared'
import { ok } from '../lib/envelope'
import { resolveClinicScope } from '../lib/scope'
import { monthlyReport } from '../services/reports.service'
import { currentYearMonthUTC } from '../services/stats.service'

export const reportsController = {
  async monthly(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as ReportQuery
      const now = currentYearMonthUTC()
      const year = q.year ?? now.year
      const month = q.month ?? now.month
      const scope = resolveClinicScope(req.user!, q.clinicId)
      const report = await monthlyReport(year, month, req.user!, scope)
      res.status(200).json(ok({ report }))
    } catch (err) {
      next(err)
    }
  },
}
