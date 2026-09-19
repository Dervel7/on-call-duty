import type { NextFunction, Request, Response } from 'express'
import { ok } from '../lib/envelope'
import * as clinicService from '../services/clinic.service'

export const clinicController = {
  async list(_req: Request, res: Response, next: NextFunction) {
    try {
      const clinics = await clinicService.list()
      res.status(200).json(ok({ clinics }))
    } catch (err) {
      next(err)
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const clinic = await clinicService.create(req.body)
      res.status(201).json(ok({ clinic }))
    } catch (err) {
      next(err)
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const clinic = await clinicService.update(Number(req.params.id), req.body)
      res.status(200).json(ok({ clinic }))
    } catch (err) {
      next(err)
    }
  },
}
