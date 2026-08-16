import type { NextFunction, Request, Response } from 'express'
import type { UnavailabilityQuery } from '@oncall/shared'
import { ok } from '../lib/envelope'
import { HttpError } from '../lib/http-error'
import * as unavailabilityService from '../services/unavailability.service'

export const unavailabilityController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const unavailability = await unavailabilityService.listAll(
        req.query as UnavailabilityQuery,
      )
      res.status(200).json(ok({ unavailability }))
    } catch (err) {
      next(err)
    }
  },
  async listMe(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      const unavailability = await unavailabilityService.listOwn(req.user.id)
      res.status(200).json(ok({ unavailability }))
    } catch (err) {
      next(err)
    }
  },
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const unavailability = await unavailabilityService.create(req.body.doctorId, req.body, req.user!)
      res.status(201).json(ok({ unavailability }))
    } catch (err) {
      next(err)
    }
  },
  async createMe(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      const unavailability = await unavailabilityService.createOwn(req.user.id, req.body)
      res.status(201).json(ok({ unavailability }))
    } catch (err) {
      next(err)
    }
  },
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      const unavailability = await unavailabilityService.update(
        Number(req.params.id),
        req.body,
        req.user,
      )
      res.status(200).json(ok({ unavailability }))
    } catch (err) {
      next(err)
    }
  },
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw new HttpError(401, 'Unauthorized')
      await unavailabilityService.remove(Number(req.params.id), req.user)
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },
}
