import type { NextFunction, Request, Response } from 'express'
import type { ScheduleQuery } from '@oncall/shared'
import { ok } from '../lib/envelope'
import { HttpError } from '../lib/http-error'
import * as scheduleService from '../services/schedule.service'

export const scheduleController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const schedules = await scheduleService.list(req.query as ScheduleQuery, req.user)
      res.status(200).json(ok({ schedules }))
    } catch (err) {
      next(err)
    }
  },
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const detail = await scheduleService.getById(Number(req.params.id), req.user)
      res.status(200).json(ok(detail))
    } catch (err) {
      next(err)
    }
  },
  async preview(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await scheduleService.preview(req.body.year, req.body.month)
      res.status(200).json(ok(result))
    } catch (err) {
      next(err)
    }
  },
  async generate(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      const detail = await scheduleService.generate(
        req.body.year,
        req.body.month,
        req.user,
        req.body.assignments,
      )
      res.status(201).json(ok(detail))
    } catch (err) {
      next(err)
    }
  },
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await scheduleService.remove(Number(req.params.id))
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },
  async addDuty(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      const duty = await scheduleService.addDuty(Number(req.params.id), req.body, req.user)
      res.status(201).json(ok({ duty }))
    } catch (err) {
      next(err)
    }
  },
  async reassignDuty(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      const duty = await scheduleService.reassignDuty(Number(req.params.id), req.body, req.user)
      res.status(200).json(ok({ duty }))
    } catch (err) {
      next(err)
    }
  },
  async removeDuty(req: Request, res: Response, next: NextFunction) {
    try {
      await scheduleService.removeDuty(Number(req.params.id))
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },
  async publish(req: Request, res: Response, next: NextFunction) {
    try {
      const schedule = await scheduleService.publish(Number(req.params.id))
      res.status(200).json(ok({ schedule }))
    } catch (err) {
      next(err)
    }
  },
  async unpublish(req: Request, res: Response, next: NextFunction) {
    try {
      const schedule = await scheduleService.unpublish(Number(req.params.id))
      res.status(200).json(ok({ schedule }))
    } catch (err) {
      next(err)
    }
  },
}
