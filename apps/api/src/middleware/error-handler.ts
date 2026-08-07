import type { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import { HttpError } from '../lib/http-error'
import { logger } from '../logger'

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const message = err.issues[0]?.message ?? 'Validation failed'
    res.status(400).json({ success: false, error: message })
    return
  }
  const status =
    err instanceof HttpError ? err.status : typeof err?.status === 'number' ? err.status : 500
  if (status >= 500) logger.error({ err }, 'request failed')
  res.status(status).json({ success: false, error: err?.message ?? 'Internal server error' })
}
