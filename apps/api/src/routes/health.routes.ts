import { Router } from 'express'
import { ok } from '../lib/envelope.ts'

export const healthRouter = Router()

healthRouter.get('/', (_req, res) => {
  res.status(200).json(ok({ status: 'ok' }))
})
