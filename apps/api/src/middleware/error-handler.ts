import type { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import { HttpError } from '../lib/http-error'
import { logger } from '../logger'

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err)
    return
  }
  if (err instanceof ZodError) {
    const message = err.issues[0]?.message ?? 'Validation failed'
    res.status(400).json({ success: false, error: message })
    return
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ success: false, error: err.message })
    return
  }
  // Postgres unique-constraint violation: report a conflict instead of a 500 leak.
  if (err instanceof Error && 'code' in err && err.code === '23505') {
    res.status(409).json({ success: false, error: 'Resource already exists' })
    return
  }
  // Trusted sub-500 statuses from framework errors (body-parser 413, etc.).
  const status =
    err instanceof Error && 'status' in err && typeof err.status === 'number' ? err.status : 500
  if (status >= 500) {
    logger.error({ err }, 'request failed')
    res.status(500).json({ success: false, error: 'Internal server error' })
    return
  }
  res.status(status).json({ success: false, error: err instanceof Error ? err.message : 'Request failed' })
}
