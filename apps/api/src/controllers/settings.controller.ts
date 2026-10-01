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
  async getDutySlots(_req: Request, res: Response, next: NextFunction) {
    try {
      const dutySlots = await settingsService.getDutySlots()
      res.status(200).json(ok({ dutySlots }))
    } catch (err) {
      next(err)
    }
  },
  async updateDutySlots(req: Request, res: Response, next: NextFunction) {
    try {
      const dutySlots = await settingsService.setDutySlots(req.body, req.user!)
      res.status(200).json(ok({ dutySlots }))
    } catch (err) {
      next(err)
    }
  },
  async getDutyMinimums(_req: Request, res: Response, next: NextFunction) {
    try {
      const dutyMinimums = await settingsService.getDutyMinimums()
      res.status(200).json(ok({ dutyMinimums }))
    } catch (err) {
      next(err)
    }
  },
  async updateDutyMinimums(req: Request, res: Response, next: NextFunction) {
    try {
      const dutyMinimums = await settingsService.setDutyMinimums(req.body, req.user!)
      res.status(200).json(ok({ dutyMinimums }))
    } catch (err) {
      next(err)
    }
  },
}
