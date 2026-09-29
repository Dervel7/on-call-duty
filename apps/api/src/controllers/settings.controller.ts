import type { NextFunction, Request, Response } from 'express'
import { ok } from '../lib/envelope'
import * as settingsService from '../services/settings.service'

export const settingsController = {
  async getOpenDuty(_req: Request, res: Response, next: NextFunction) {
    try {
      const openDuty = await settingsService.getOpenDutySettings()
      res.status(200).json(ok({ openDuty }))
    } catch (err) {
      next(err)
    }
  },
  async updateOpenDuty(req: Request, res: Response, next: NextFunction) {
    try {
      const openDuty = await settingsService.setOpenDutyInterval(req.body, req.user!)
      res.status(200).json(ok({ openDuty }))
    } catch (err) {
      next(err)
    }
  },
}
