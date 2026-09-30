import type { NextFunction, Request, Response } from 'express'
import type { HolidayQuery, SetMonthHolidaysRequest } from '@oncall/shared'
import { ok } from '../lib/envelope'
import { resolveClinicScope } from '../lib/scope'
import * as holidayService from '../services/holiday.service'

export const holidayController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      // req.query is typed by validate(holidayQuerySchema) upstream.
      const { clinicId, year } = req.query as unknown as HolidayQuery & {
        clinicId?: number
      }
      const scope = await resolveClinicScope(req.user!, clinicId)
      const holidays = await holidayService.list(year, scope)
      res.status(200).json(ok({ holidays }))
    } catch (err) {
      next(err)
    }
  },
  async setMonth(req: Request, res: Response, next: NextFunction) {
    try {
      // Clinic resolution mirrors the other admin write endpoints:
      // manager must name the clinic via ?clinicId=; superadmin defaults
      // to the sole clinic of a single-clinic deployment.
      const { clinicId } = req.query as { clinicId?: number }
      const scope = await resolveClinicScope(req.user!, clinicId)
      const holidays = await holidayService.setMonth(
        req.body as SetMonthHolidaysRequest,
        req.user!,
        scope,
      )
      res.status(200).json(ok({ holidays }))
    } catch (err) {
      next(err)
    }
  },
}
