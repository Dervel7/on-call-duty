import type { NextFunction, Request, Response } from 'express'
import { env } from '../config/env'
import { HttpError } from '../lib/http-error'

interface Options {
  windowMs: number
  limit: number
  keyFn?: (req: Request) => string
}

interface Entry {
  count: number
  resetAt: number
}

const MAX_BUCKETS = 10_000

/**
 * Fixed-window in-memory rate limiter. Single-instance only (no shared store),
 * which matches the current single-container deployment. Disabled under test.
 */
export function rateLimit({ windowMs, limit, keyFn }: Options) {
  const buckets = new Map<string, Entry>()
  if (env.NODE_ENV === 'test') {
    return (_req: Request, _res: Response, next: NextFunction) => next()
  }
  return (req: Request, _res: Response, next: NextFunction) => {
    if (buckets.size > MAX_BUCKETS) {
      const now = Date.now()
      for (const [key, entry] of buckets) {
        if (entry.resetAt <= now) buckets.delete(key)
      }
    }
    const key = keyFn ? keyFn(req) : (req.ip ?? 'unknown')
    const now = Date.now()
    const entry = buckets.get(key)
    if (!entry || entry.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      next()
      return
    }
    entry.count += 1
    if (entry.count > limit) throw new HttpError(429, 'Too many requests; try again later')
    next()
  }
}
