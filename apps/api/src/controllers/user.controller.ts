import type { NextFunction, Request, Response } from 'express'
import { ok } from '../lib/envelope'
import { resolveClinicScope } from '../lib/scope'
import * as userService from '../services/user.service'
export const userController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      // req.query is typed by validate(userQuerySchema) upstream.
      const { clinicId } = req.query as { clinicId?: number }
      const scope = resolveClinicScope(req.user!, clinicId)
      const users = await userService.list(req.user!, scope)
      res.status(200).json(ok({ users }))
    } catch (err) {
      next(err)
    }
  },
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await userService.getById(Number(req.params.id), req.user!)
      res.status(200).json(ok({ user }))
    } catch (err) {
      next(err)
    }
  },
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await userService.create(req.body, req.user!)
      res.status(201).json(ok({ user }))
    } catch (err) {
      next(err)
    }
  },
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await userService.update(Number(req.params.id), req.body, req.user!)
      res.status(200).json(ok({ user }))
    } catch (err) {
      next(err)
    }
  },
  async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await userService.resetPassword(Number(req.params.id), req.body, req.user!)
      res.status(200).json(ok({ user }))
    } catch (err) {
      next(err)
    }
  },
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await userService.remove(Number(req.params.id), req.user!)
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },

  async updateTheme(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await userService.updateTheme(req.user!.id, req.body.darkMode)
      res.status(200).json(ok({ user }))
    } catch (err) {
      next(err)
    }
  },
}
