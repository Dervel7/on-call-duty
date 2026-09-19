import type { NextFunction, Request, Response } from 'express'
import type { ActivityQuery } from '@oncall/shared'
import { ok } from '../lib/envelope'
import { resolveClinicScope } from '../lib/scope'
import * as activityService from '../services/activity.service'

export const activityController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { clinicId, ...filters } = req.query as ActivityQuery & { clinicId?: number }
      const scope = resolveClinicScope(req.user!, clinicId)
      const activity = await activityService.list(filters, scope)
      res.status(200).json(ok({ activity }))
    } catch (err) {
      next(err)
    }
  },
}
