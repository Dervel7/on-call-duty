import type { NextFunction, Request, Response } from 'express'
import { ok } from '../lib/envelope'
import { HttpError } from '../lib/http-error'
import { resolveClinicScope } from '../lib/scope'
import * as doctorService from '../services/doctor.service'

export const doctorController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      // req.query is typed by validate(doctorQuerySchema) upstream.
      const { clinicId } = req.query as { clinicId?: number }
      const scope = resolveClinicScope(req.user!, clinicId)
      const doctors = await doctorService.list(scope)
      res.status(200).json(ok({ doctors }))
    } catch (err) {
      next(err)
    }
  },
  async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      const doctor = await doctorService.getByUserId(req.user.id)
      res.status(200).json(ok({ doctor }))
    } catch (err) {
      next(err)
    }
  },
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const doctor = await doctorService.getById(Number(req.params.id), req.user!)
      res.status(200).json(ok({ doctor }))
    } catch (err) {
      next(err)
    }
  },
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      // req.query is typed by validate(doctorQuerySchema) upstream.
      const { clinicId } = req.query as { clinicId?: number }
      const scope = resolveClinicScope(req.user!, clinicId)
      const doctor = await doctorService.create(req.body, req.user!, scope)
      res.status(201).json(ok({ doctor }))
    } catch (err) {
      next(err)
    }
  },
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const doctor = await doctorService.update(Number(req.params.id), req.body, req.user!)
      res.status(200).json(ok({ doctor }))
    } catch (err) {
      next(err)
    }
  },
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await doctorService.remove(Number(req.params.id), req.user!)
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },
}
