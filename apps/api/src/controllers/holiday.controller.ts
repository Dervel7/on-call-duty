import type { NextFunction, Request, Response } from 'express'
import type { HolidayQuery } from '@oncall/shared'
import { ok } from '../lib/envelope'
import * as holidayService from '../services/holiday.service'

export const holidayController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const holidays = await holidayService.list(req.query as HolidayQuery)
      res.status(200).json(ok({ holidays }))
    } catch (err) {
      next(err)
    }
  },
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const holiday = await holidayService.create(req.body, req.user!)
      res.status(201).json(ok({ holiday }))
    } catch (err) {
      next(err)
    }
  },
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const holiday = await holidayService.update(Number(req.params.id), req.body, req.user!)
      res.status(200).json(ok({ holiday }))
    } catch (err) {
      next(err)
    }
  },
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await holidayService.remove(Number(req.params.id), req.user!)
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },
}
