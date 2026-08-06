import type { ErrorRequestHandler } from 'express'
import { logger } from '../logger'

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = typeof err?.status === 'number' ? err.status : 500
  logger.error({ err }, 'request failed')
  res.status(status).json({ success: false, error: err?.message ?? 'Internal server error' })
}
