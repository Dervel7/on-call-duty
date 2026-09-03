import type { NextFunction, Request, Response } from 'express'
import { ok } from '../lib/envelope'
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
      const alert = await usageService.resolveAlert(Number(req.params.id))
      res.status(200).json(ok({ alert }))
    } catch (err) {
      next(err)
    }
  },
  async recordGeneratePress(req: Request, res: Response, next: NextFunction) {
    try {
      await usageService.recordGeneratePress(req.user!.id)
      res.status(204).send()
    } catch (err) {
      next(err)
    }
  },
  async generatePresses(_req: Request, res: Response, next: NextFunction) {
    try {
      const presses = await usageService.generatePressCounts()
      res.status(200).json(ok(presses))
    } catch (err) {
      next(err)
    }
  },
}
