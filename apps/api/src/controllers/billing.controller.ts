import type { NextFunction, Request, Response } from 'express'
import { ok } from '../lib/envelope'
import * as billingService from '../services/billing.service'

export const billingController = {
  async getState(_req: Request, res: Response, next: NextFunction) {
    try {
      const billing = await billingService.getState()
      res.status(200).json(ok({ billing }))
    } catch (err) {
      next(err)
    }
  },
  async setPaidThrough(req: Request, res: Response, next: NextFunction) {
    try {
      const billing = await billingService.setPaidThrough(req.body, req.user!)
      res.status(200).json(ok({ billing }))
    } catch (err) {
      next(err)
    }
  },
}
