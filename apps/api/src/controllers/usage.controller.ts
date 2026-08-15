import type { NextFunction, Request, Response } from 'express'
import { ok } from '../lib/envelope'
import { HttpError } from '../lib/http-error'
import * as usageService from '../services/usage.service'

export const usageController = {
  async summary(_req: Request, res: Response, next: NextFunction) {
    try {
      const summary = await usageService.summary()
      res.status(200).json(ok({ summary }))
    } catch (err) {
      next(err)
    }
  },
  async generations(_req: Request, res: Response, next: NextFunction) {
    try {
      const generations = await usageService.generations()
      res.status(200).json(ok({ generations }))
    } catch (err) {
      next(err)
    }
  },
  async alerts(_req: Request, res: Response, next: NextFunction) {
    try {
      const alerts = await usageService.listAlerts()
      res.status(200).json(ok({ alerts }))
    } catch (err) {
      next(err)
    }
  },
  async resolveAlert(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id)
      if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid alert id')
      const alert = await usageService.resolveAlert(id)
      res.status(200).json(ok({ alert }))
    } catch (err) {
      next(err)
    }
  },
}
