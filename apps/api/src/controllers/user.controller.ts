import type { NextFunction, Request, Response } from 'express'
import { ok } from '../lib/envelope'
import * as userService from '../services/user.service'

export const userController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const users = await userService.list(req.user!)
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
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await userService.remove(Number(req.params.id), req.user!)
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },
}
