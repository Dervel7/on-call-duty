import type { NextFunction, Request, Response } from 'express'
import type { ActivityQuery } from '@oncall/shared'
import { ok } from '../lib/envelope'
import * as activityService from '../services/activity.service'

export const activityController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const activity = await activityService.list(req.query as ActivityQuery)
      res.status(200).json(ok({ activity }))
    } catch (err) {
      next(err)
    }
  },
}
